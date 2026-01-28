use anchor_spl::associated_token::spl_associated_token_account::solana_program;
use solana_program::hash::{hash};

pub fn verify_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: [u8; 32], index: u32) -> bool {
    let mut computed_hash = leaf;
    let mut idx = index;

    for sibling in proof.iter() {
        if idx % 2 == 0 {
            computed_hash = hash_pair(&computed_hash, sibling);
        } else {
            computed_hash = hash_pair(sibling, &computed_hash);
        }
        idx /= 2;
    }

    computed_hash == root
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(left);
    combined[32..].copy_from_slice(right);
    hash(&combined).to_bytes()
}

pub fn create_leaf(pack_index: u32, token_amount: u64, salt: [u8; 32]) -> [u8; 32] {
    let mut data = Vec::with_capacity(44); 
    data.extend_from_slice(&pack_index.to_le_bytes());
    data.extend_from_slice(&token_amount.to_le_bytes());
    data.extend_from_slice(&salt);
    hash(&data).to_bytes()
}