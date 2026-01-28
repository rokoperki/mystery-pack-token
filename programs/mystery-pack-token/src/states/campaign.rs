
use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account(discriminator = 1)]
pub struct Campaign {
    pub seed: u64,                  // 8 bytes
    pub authority: Pubkey,          // 32 bytes
    pub token_mint: Pubkey,         // 32 bytes
    pub pack_price: u64,            // 8 bytes
    pub total_packs: u32,           // 4 bytes
    pub packs_sold: u32,            // 4 bytes
    pub merkle_root: [u8; 32],      // 32 bytes
    pub is_active: bool,            // 1 byte
    pub bump: u8,                   // 1 byte - campaign PDA bump
    pub vault_bump: u8,             // 1 byte - sol_vault PDA bump
}