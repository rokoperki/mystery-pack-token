
use anchor_lang::prelude::*;

#[derive(InitSpace)]
#[account(discriminator = 1)]
pub struct Campaign {
    pub seed: u64,            
    pub authority: Pubkey,     
    pub token_mint: Pubkey,    
    pub pack_price: u64,      
    pub total_packs: u32,     
    pub packs_sold: u32,      
    pub merkle_root: [u8; 32], 
    pub is_active: bool,     
    pub bump: u8,                  
    pub vault_bump: u8,            
}