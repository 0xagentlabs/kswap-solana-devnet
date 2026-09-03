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
use pinocchio_token::{
    instructions::{Burn, InitializeMint2, MintTo, Transfer},
    state::{Mint, TokenAccount},
};

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
        2 => add_liquidity(accounts, args),
        3 => remove_liquidity(accounts, args),
        4 => migrate_liquidity(accounts, args),
        5 => seed_initial_liquidity(accounts, args),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// Accounts: provider(s), pool, provider A(w), provider B(w), vault A(w), vault B(w),
// LP mint(w), provider LP(w), token program. Data: max_a:u64|max_b:u64|min_lp:u64.
fn add_liquidity(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 9 || d.len() != 24 {
        return Err(SwapError::InvalidAccounts.into());
    }
    let (user, pool, ua, ub, va, vb, lp_mint, user_lp, tp) = (
        &a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6], &a[7], &a[8],
    );
    validate_liquidity_accounts(user, pool, ua, ub, va, vb, lp_mint, user_lp, tp)?;
    let max_a = read_u64(&d[0..8]);
    let max_b = read_u64(&d[8..16]);
    let min_lp = read_u64(&d[16..24]);
    if max_a == 0 || max_b == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    let reserve_a = TokenAccount::from_account_info(va)?.amount() as u128;
    let reserve_b = TokenAccount::from_account_info(vb)?.amount() as u128;
    let supply = Mint::from_account_info(lp_mint)?.supply() as u128;
    if reserve_a == 0 || reserve_b == 0 || supply == 0 {
        return Err(SwapError::InvalidState.into());
    }
    let shares_a = (max_a as u128)
        .checked_mul(supply)
        .ok_or(SwapError::MathOverflow)?
        / reserve_a;
    let shares_b = (max_b as u128)
        .checked_mul(supply)
        .ok_or(SwapError::MathOverflow)?
        / reserve_b;
    let shares = core::cmp::min(shares_a, shares_b);
    let amount_a = ceil_div(
        shares
            .checked_mul(reserve_a)
            .ok_or(SwapError::MathOverflow)?,
        supply,
    )?;
    let amount_b = ceil_div(
        shares
            .checked_mul(reserve_b)
            .ok_or(SwapError::MathOverflow)?,
        supply,
    )?;
    let shares = u64::try_from(shares).map_err(|_| SwapError::MathOverflow)?;
    let amount_a = u64::try_from(amount_a).map_err(|_| SwapError::MathOverflow)?;
    let amount_b = u64::try_from(amount_b).map_err(|_| SwapError::MathOverflow)?;
    if shares == 0 || shares < min_lp || amount_a > max_a || amount_b > max_b {
        return Err(SwapError::Slippage.into());
    }
    let user_a_amount = TokenAccount::from_account_info(ua)?.amount();
    let user_b_amount = TokenAccount::from_account_info(ub)?.amount();
    if user_a_amount < amount_a || user_b_amount < amount_b {
        return Err(SwapError::InvalidAmount.into());
    }
    Transfer {
        from: ua,
        to: va,
        authority: user,
        amount: amount_a,
    }
    .invoke()?;
    Transfer {
        from: ub,
        to: vb,
        authority: user,
        amount: amount_b,
    }
    .invoke()?;
    let (bump, owner) = {
        let pd = pool.try_borrow_data()?;
        ([pd[1]], <[u8; 32]>::try_from(&pd[4..36]).unwrap())
    };
    let seeds = [
        Seed::from(b"pool"),
        Seed::from(owner.as_ref()),
        Seed::from(&bump),
    ];
    MintTo {
        mint: lp_mint,
        account: user_lp,
        mint_authority: pool,
        amount: shares,
    }
    .invoke_signed(&[Signer::from(&seeds)])
}

fn remove_liquidity(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 9 || d.len() != 24 {
        return Err(SwapError::InvalidAccounts.into());
    }
    let (user, pool, ua, ub, va, vb, lp_mint, user_lp, tp) = (
        &a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6], &a[7], &a[8],
    );
    validate_liquidity_accounts(user, pool, ua, ub, va, vb, lp_mint, user_lp, tp)?;
    let lp_amount = read_u64(&d[0..8]);
    let min_a = read_u64(&d[8..16]);
    let min_b = read_u64(&d[16..24]);
    let supply = Mint::from_account_info(lp_mint)?.supply() as u128;
    let reserve_a = TokenAccount::from_account_info(va)?.amount() as u128;
    let reserve_b = TokenAccount::from_account_info(vb)?.amount() as u128;
    if lp_amount == 0 || supply == 0 || lp_amount as u128 > supply {
        return Err(SwapError::InvalidAmount.into());
    }
    let amount_a = u64::try_from(
        reserve_a
            .checked_mul(lp_amount as u128)
            .ok_or(SwapError::MathOverflow)?
            / supply,
    )
    .map_err(|_| SwapError::MathOverflow)?;
    let amount_b = u64::try_from(
        reserve_b
            .checked_mul(lp_amount as u128)
            .ok_or(SwapError::MathOverflow)?
            / supply,
    )
    .map_err(|_| SwapError::MathOverflow)?;
    if amount_a == 0 || amount_b == 0 || amount_a < min_a || amount_b < min_b {
        return Err(SwapError::Slippage.into());
    }
    Burn {
        account: user_lp,
        mint: lp_mint,
        authority: user,
        amount: lp_amount,
    }
    .invoke()?;
    let (bump_bytes, owner) = {
        let pd = pool.try_borrow_data()?;
        ([pd[1]], <[u8; 32]>::try_from(&pd[4..36]).unwrap())
    };
    let seeds = [
        Seed::from(b"pool"),
        Seed::from(owner.as_ref()),
        Seed::from(&bump_bytes),
    ];
    let signer = Signer::from(&seeds);
    Transfer {
        from: va,
        to: ua,
        authority: pool,
        amount: amount_a,
    }
    .invoke_signed(&[signer])?;
    Transfer {
        from: vb,
        to: ub,
        authority: pool,
        amount: amount_b,
    }
    .invoke_signed(&[Signer::from(&seeds)])
}

#[allow(clippy::too_many_arguments)]
fn validate_liquidity_accounts(
    user: &AccountInfo,
    pool: &AccountInfo,
    ua: &AccountInfo,
    ub: &AccountInfo,
    va: &AccountInfo,
    vb: &AccountInfo,
    lp_mint: &AccountInfo,
    user_lp: &AccountInfo,
    tp: &AccountInfo,
) -> ProgramResult {
    if !user.is_signer()
        || !ua.is_writable()
        || !ub.is_writable()
        || !va.is_writable()
        || !vb.is_writable()
        || pool.owner() != &ID
        || !lp_mint.is_writable()
        || !user_lp.is_writable()
        || tp.key() != &pinocchio_token::ID
        || ua.key() == ub.key()
        || va.key() == vb.key()
    {
        return Err(SwapError::InvalidAccounts.into());
    }
    let pd = pool.try_borrow_data()?;
    if pd.len() != POOL_LEN || pd[0] != DISC {
        return Err(SwapError::InvalidState.into());
    }
    let (expected_lp, _) = find_program_address(&[b"lp_mint", pool.key().as_ref()], &ID);
    if lp_mint.key() != &expected_lp {
        return Err(SwapError::InvalidPda.into());
    }
    let ua = TokenAccount::from_account_info(ua)?;
    let ub = TokenAccount::from_account_info(ub)?;
    let vault_a = TokenAccount::from_account_info(va)?;
    let vault_b = TokenAccount::from_account_info(vb)?;
    let lp = TokenAccount::from_account_info(user_lp)?;
    let mint = Mint::from_account_info(lp_mint)?;
    if va.key() != <&[u8; 32]>::try_from(&pd[100..132]).unwrap()
        || vb.key() != <&[u8; 32]>::try_from(&pd[132..164]).unwrap()
        || ua.owner() != user.key()
        || ub.owner() != user.key()
        || ua.mint() != vault_a.mint()
        || ub.mint() != vault_b.mint()
        || vault_a.owner() != pool.key()
        || vault_b.owner() != pool.key()
        || lp.owner() != user.key()
        || lp.mint() != lp_mint.key()
        || mint.mint_authority() != Some(pool.key())
    {
        return Err(SwapError::InvalidMint.into());
    }
    Ok(())
}

// One-time legacy migration: creates deterministic LP mint and assigns the initial
// sqrt(k) supply to the original pool owner.
fn migrate_liquidity(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 8 || !d.is_empty() {
        return Err(SwapError::InvalidAccounts.into());
    }
    let (owner, pool, va, vb, lp_mint, system, rent, tp) =
        (&a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6], &a[7]);
    if !owner.is_signer()
        || !owner.is_writable()
        || pool.owner() != &ID
        || system.key() != &pinocchio_system::ID
        || tp.key() != &pinocchio_token::ID
        || lp_mint.data_len() != 0
    {
        return Err(SwapError::InvalidAccounts.into());
    }
    let pd = pool.try_borrow_data()?;
    if pd.len() != POOL_LEN
        || pd[0] != DISC
        || owner.key() != <&[u8; 32]>::try_from(&pd[4..36]).unwrap()
        || va.key() != <&[u8; 32]>::try_from(&pd[100..132]).unwrap()
        || vb.key() != <&[u8; 32]>::try_from(&pd[132..164]).unwrap()
    {
        return Err(SwapError::Unauthorized.into());
    }
    let vault_a = TokenAccount::from_account_info(va)?;
    let vault_b = TokenAccount::from_account_info(vb)?;
    if vault_a.owner() != pool.key() || vault_b.owner() != pool.key() {
        return Err(SwapError::InvalidMint.into());
    }
    if vault_a.amount() == 0 || vault_b.amount() == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    let (expected, bump) = find_program_address(&[b"lp_mint", pool.key().as_ref()], &ID);
    if lp_mint.key() != &expected {
        return Err(SwapError::InvalidPda.into());
    }
    let bump_bytes = [bump];
    let mint_seeds = [
        Seed::from(b"lp_mint"),
        Seed::from(pool.key().as_ref()),
        Seed::from(&bump_bytes),
    ];
    CreateAccount {
        from: owner,
        to: lp_mint,
        lamports: rent_lamports(rent, Mint::LEN)?,
        space: Mint::LEN as u64,
        owner: &pinocchio_token::ID,
    }
    .invoke_signed(&[Signer::from(&mint_seeds)])?;
    InitializeMint2 {
        mint: lp_mint,
        decimals: 9,
        mint_authority: pool.key(),
        freeze_authority: None,
    }
    .invoke()
}

fn seed_initial_liquidity(a: &[AccountInfo], d: &[u8]) -> ProgramResult {
    if a.len() != 7 || !d.is_empty() {
        return Err(SwapError::InvalidAccounts.into());
    }
    let (owner, pool, va, vb, lp_mint, owner_lp, tp) =
        (&a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6]);
    if !owner.is_signer() || pool.owner() != &ID || tp.key() != &pinocchio_token::ID {
        return Err(SwapError::InvalidAccounts.into());
    }
    let (pool_bump, pool_owner) = {
        let pd = pool.try_borrow_data()?;
        if pd.len() != POOL_LEN
            || pd[0] != DISC
            || owner.key() != <&[u8; 32]>::try_from(&pd[4..36]).unwrap()
            || va.key() != <&[u8; 32]>::try_from(&pd[100..132]).unwrap()
            || vb.key() != <&[u8; 32]>::try_from(&pd[132..164]).unwrap()
        {
            return Err(SwapError::Unauthorized.into());
        }
        ([pd[1]], <[u8; 32]>::try_from(&pd[4..36]).unwrap())
    };
    let (expected, _) = find_program_address(&[b"lp_mint", pool.key().as_ref()], &ID);
    {
        let mint = Mint::from_account_info(lp_mint)?;
        if lp_mint.key() != &expected
            || mint.supply() != 0
            || mint.mint_authority() != Some(pool.key())
        {
            return Err(SwapError::InvalidState.into());
        }
    }
    let (reserve_a, reserve_b) = {
        let vault_a = TokenAccount::from_account_info(va)?;
        let vault_b = TokenAccount::from_account_info(vb)?;
        let destination = TokenAccount::from_account_info(owner_lp)?;
        if vault_a.owner() != pool.key()
            || vault_b.owner() != pool.key()
            || destination.owner() != owner.key()
            || destination.mint() != lp_mint.key()
        {
            return Err(SwapError::InvalidMint.into());
        }
        (vault_a.amount(), vault_b.amount())
    };
    let shares = integer_sqrt(
        (reserve_a as u128)
            .checked_mul(reserve_b as u128)
            .ok_or(SwapError::MathOverflow)?,
    );
    let shares = u64::try_from(shares).map_err(|_| SwapError::MathOverflow)?;
    if shares == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    let pool_seeds = [
        Seed::from(b"pool"),
        Seed::from(pool_owner.as_ref()),
        Seed::from(&pool_bump),
    ];
    MintTo {
        mint: lp_mint,
        account: owner_lp,
        mint_authority: pool,
        amount: shares,
    }
    .invoke_signed(&[Signer::from(&pool_seeds)])
}

fn read_u64(d: &[u8]) -> u64 {
    u64::from_le_bytes(d.try_into().unwrap())
}
fn ceil_div(n: u128, d: u128) -> Result<u128, ProgramError> {
    n.checked_add(d - 1)
        .map(|v| v / d)
        .ok_or(SwapError::MathOverflow.into())
}
fn integer_sqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = x.div_ceil(2);
    while y < x {
        x = y;
        y = (x + n / x) / 2
    }
    x
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
    let (fee, bump_bytes, pool_owner) = {
        let pd = pool.try_borrow_data()?;
        if pd.len() != POOL_LEN || pd[0] != DISC {
            return Err(SwapError::InvalidState.into());
        }
        let fee = u16::from_le_bytes([pd[2], pd[3]]) as u128;
        let forward = vs.key() == <&[u8; 32]>::try_from(&pd[100..132]).unwrap()
            && vd.key() == <&[u8; 32]>::try_from(&pd[132..164]).unwrap();
        let reverse = vs.key() == <&[u8; 32]>::try_from(&pd[132..164]).unwrap()
            && vd.key() == <&[u8; 32]>::try_from(&pd[100..132]).unwrap();
        if !forward && !reverse {
            return Err(SwapError::InvalidMint.into());
        }
        (fee, [pd[1]], <[u8; 32]>::try_from(&pd[4..36]).unwrap())
    };
    let (reserve_source, reserve_destination) = {
        let src = TokenAccount::from_account_info(us)?;
        let dst = TokenAccount::from_account_info(ud)?;
        let vsrc = TokenAccount::from_account_info(vs)?;
        let vdst = TokenAccount::from_account_info(vd)?;
        if src.mint() != vsrc.mint()
            || dst.mint() != vdst.mint()
            || vsrc.owner() != pool.key()
            || vdst.owner() != pool.key()
        {
            return Err(SwapError::InvalidMint.into());
        }
        (vsrc.amount(), vdst.amount())
    };
    let amount = u64::from_le_bytes(d[0..8].try_into().unwrap());
    let min = u64::from_le_bytes(d[8..16].try_into().unwrap());
    if amount == 0 {
        return Err(SwapError::InvalidAmount.into());
    }
    let effective = (amount as u128)
        .checked_mul(10_000 - fee)
        .ok_or(SwapError::MathOverflow)?;
    let num = (reserve_destination as u128)
        .checked_mul(effective)
        .ok_or(SwapError::MathOverflow)?;
    let den = (reserve_source as u128)
        .checked_mul(10_000)
        .and_then(|x| x.checked_add(effective))
        .ok_or(SwapError::MathOverflow)?;
    let out = u64::try_from(num / den).map_err(|_| SwapError::MathOverflow)?;
    if out == 0 || out < min || out >= reserve_destination {
        return Err(SwapError::Slippage.into());
    }
    Transfer {
        from: us,
        to: vs,
        authority: user,
        amount,
    }
    .invoke()?;
    let seeds = [
        Seed::from(b"pool"),
        Seed::from(pool_owner.as_ref()),
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
    #[test]
    fn lp_initial_supply_and_rounding() {
        assert_eq!(integer_sqrt(1_000_000), 1_000);
        assert_eq!(integer_sqrt(2), 1);
        assert_eq!(ceil_div(1001, 1000).unwrap(), 2);
    }
    #[test]
    fn proportional_lp_math() {
        let supply = 1_000u128;
        let shares = core::cmp::min(100u128 * supply / 1_000, 250u128 * supply / 2_000);
        assert_eq!(shares, 100);
        assert_eq!(2_000u128 * shares / supply, 200);
    }
}
