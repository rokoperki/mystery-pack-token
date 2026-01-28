use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account(discriminator = 2)]
pub struct Receipt {
    pub campaign: Pubkey,
    pub buyer: Pubkey,
    pub pack_index: u32,
    pub is_claimed: bool,
}
