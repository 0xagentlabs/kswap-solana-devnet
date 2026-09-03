#![no_std]
#![allow(unexpected_cfgs)]

use pinocchio::sysvars::rent::Rent;
use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::{instructions::Transfer, state::TokenAccount};

entrypoint!(process_instruction);
pinocchio::nostd_panic_handler!();

pub const ID: Pubkey = [
    0xa1, 0xa3, 0xe3, 0x16, 0x82, 0xf2, 0xba, 0x08, 0xf6, 0x14, 0xdc, 0x10, 0x22, 0x25, 0x72, 0x65,
    0xc7, 0xb9, 0xc7, 0x81, 0x42, 0x70, 0xe9, 0xd4, 0x5d, 0x87, 0xa3, 0xbd, 0x8c, 0x51, 0x04, 0x85,
];
const POOL_LEN: usize = 164;
const DISC: u8 = 1;

#[repr(u32)]
pub enum SwapError {
    InvalidAccounts = 1,
    InvalidPda,
    InvalidState,
    InvalidMint,
    InvalidAmount,
    Slippage,
    MathOverflow,
    Unauthorized,
    InvalidFee,
}
impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (tag, args) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(accounts, args),
        1 => swap(accounts, args),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// Pool: disc(1), bump(1), fee_bps(2), owner(32), mint_a(32), mint_b(32), vault_a(32), vault_b(32).
fn initialize(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 6 || d.len() != 2 {
        return Err(SwapError::InvalidAccounts.into());
    }
    let payer = &a[0];
    let pool = &a[1];
    let va = &a[2];
    let vb = &a[3];
    let system = &a[4];
    let rent = &a[5];
    if !payer.is_signer() || !payer.is_writable() || !pool.is_writable() {
        return Err(SwapError::InvalidAccounts.into());
    }
    if system.key() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let fee = u16::from_le_bytes([d[0], d[1]]);
    if fee > 1000 {
        return Err(SwapError::InvalidFee.into());
    }
    let (expected, bump) = find_program_address(&[b"pool", payer.key().as_ref()], &ID);
    if pool.key() != &expected || pool.data_len() != 0 {
        return Err(SwapError::InvalidPda.into());
    }
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(b"pool"),
        Seed::from(payer.key().as_ref()),
        Seed::from(&bump_bytes),
    ];
    let signer = Signer::from(&seeds);
    CreateAccount {
        from: payer,
        to: pool,
        lamports: rent_lamports(rent, POOL_LEN)?,
        space: POOL_LEN as u64,
        owner: &ID,
    }
    .invoke_signed(&[signer])?;
    let ta = TokenAccount::from_account_info(va)?;
    let tb = TokenAccount::from_account_info(vb)?;
    if va.key() == vb.key()
        || ta.mint() == tb.mint()
        || ta.owner() != pool.key()
        || tb.owner() != pool.key()
    {
        return Err(SwapError::InvalidMint.into());
    }
    let mut out = pool.try_borrow_mut_data()?;
    out[0] = DISC;
    out[1] = bump;
    out[2..4].copy_from_slice(&fee.to_le_bytes());
    out[4..36].copy_from_slice(payer.key());
    out[36..68].copy_from_slice(ta.mint());
    out[68..100].copy_from_slice(tb.mint());
    out[100..132].copy_from_slice(va.key());
    out[132..164].copy_from_slice(vb.key());
    Ok(())
}

// Accounts: user(s,w), pool, user_source(w), user_dest(w), vault_source(w), vault_dest(w), token_program.
// Data: tag | amount_in:u64 | min_out:u64. Constant product uses live vault balances.
fn swap(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 7 || d.len() != 16 {
        return Err(SwapError::InvalidAccounts.into());
    }
    let user = &a[0];
    let pool = &a[1];
    let us = &a[2];
    let ud = &a[3];
    let vs = &a[4];
    let vd = &a[5];
    let tp = &a[6];
    if !user.is_signer()
        || !us.is_writable()
        || !ud.is_writable()
        || !vs.is_writable()
        || !vd.is_writable()
        || pool.owner() != &ID
        || tp.key() != &pinocchio_token::ID
    {
        return Err(SwapError::InvalidAccounts.into());
    }
    if us.key() == ud.key() || vs.key() == vd.key() || us.key() == vs.key() || ud.key() == vd.key()
    {
        return Err(SwapError::InvalidAccounts.into());
    }
    let pd = pool.try_borrow_data()?;
    if pd.len() != POOL_LEN || pd[0] != DISC {
        return Err(SwapError::InvalidState.into());
    }
    let fee = u16::from_le_bytes([pd[2], pd[3]]) as u128;
    let src = TokenAccount::from_account_info(us)?;
    let dst = TokenAccount::from_account_info(ud)?;
    let vsrc = TokenAccount::from_account_info(vs)?;
    let vdst = TokenAccount::from_account_info(vd)?;
    let forward = vs.key() == <&[u8; 32]>::try_from(&pd[100..132]).unwrap()
        && vd.key() == <&[u8; 32]>::try_from(&pd[132..164]).unwrap();
    let reverse = vs.key() == <&[u8; 32]>::try_from(&pd[132..164]).unwrap()
        && vd.key() == <&[u8; 32]>::try_from(&pd[100..132]).unwrap();
    if (!forward && !reverse)
        || src.mint() != vsrc.mint()
        || dst.mint() != vdst.mint()
        || vsrc.owner() != pool.key()
        || vdst.owner() != pool.key()
    {
        return Err(SwapError::InvalidMint.into());
    }
    let amount = u64::from_le_bytes(d[0..8].try_into().unwrap());
    let min = u64::from_le_bytes(d[8..16].try_into().unwrap());
    if amount == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    let effective = (amount as u128)
        .checked_mul(10_000 - fee)
        .ok_or(SwapError::MathOverflow)?;
    let num = (vdst.amount() as u128)
        .checked_mul(effective)
        .ok_or(SwapError::MathOverflow)?;
    let den = (vsrc.amount() as u128)
        .checked_mul(10_000)
        .and_then(|x| x.checked_add(effective))
        .ok_or(SwapError::MathOverflow)?;
    let out = u64::try_from(num / den).map_err(|_| SwapError::MathOverflow)?;
    if out == 0 || out < min || out >= vdst.amount() {
        return Err(SwapError::Slippage.into());
    }
    Transfer {
        from: us,
        to: vs,
        authority: user,
        amount,
    }
    .invoke()?;
    let bump_bytes = [pd[1]];
    let owner: [u8; 32] = pd[4..36].try_into().unwrap();
    let seeds = [
        Seed::from(b"pool"),
        Seed::from(owner.as_ref()),
        Seed::from(&bump_bytes),
    ];
    Transfer {
        from: vd,
        to: ud,
        authority: pool,
        amount: out,
    }
    .invoke_signed(&[Signer::from(&seeds)])
}

fn rent_lamports(rent: &AccountInfo, len: usize) -> Result<u64, ProgramError> {
    Ok(Rent::from_account_info(rent)?.minimum_balance(len))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fee_math() {
        let a = 1_000u128;
        let r = 10_000u128;
        let e = a * 9_970;
        assert_eq!(r * e / (r * 10_000 + e), 906);
    }
    #[test]
    fn layout() {
        assert_eq!(POOL_LEN, 164);
    }
}
