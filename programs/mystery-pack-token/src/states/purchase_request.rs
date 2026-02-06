
use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account(discriminator = 3)]
pub struct PurchaseRequest {
    pub campaign: Pubkey,
    pub buyer: Pubkey,
    pub commit_slot: u64,
    pub randomness_account: Pubkey,
    pub nonce: u64,
    pub pack_index: Option<u32>,  
    pub bump: u8,
}