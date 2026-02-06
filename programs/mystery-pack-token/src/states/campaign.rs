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
    pub packs_committed: u32,
    pub available_bitmap: [u8; 32],
    pub is_active: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Campaign {
    pub fn is_pack_available(&self, index: u32) -> bool {
        if index >= self.total_packs {
            return false;
        }
        let byte_index = (index / 8) as usize;
        let bit_index = index % 8;
        if byte_index >= self.available_bitmap.len() {
            return false;
        }
        (self.available_bitmap[byte_index] & (1 << bit_index)) != 0
    }

    pub fn mark_pack_taken(&mut self, index: u32) {
        let byte_index = (index / 8) as usize;
        let bit_index = index % 8;
        if byte_index < self.available_bitmap.len() {
            self.available_bitmap[byte_index] &= !(1 << bit_index);
        }
    }

    pub fn available_count(&self) -> u32 {
        self.total_packs - self.packs_sold - self.packs_committed
    }

    pub fn get_nth_available(&self, n: u32) -> Option<u32> {
        let mut count = 0u32;
        for i in 0..self.total_packs {
            if self.is_pack_available(i) {
                if count == n {
                    return Some(i);
                }
                count += 1;
            }
        }
        None
    }
}
