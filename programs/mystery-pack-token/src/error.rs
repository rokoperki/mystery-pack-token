// src/error.rs

use anchor_lang::prelude::*;

#[error_code]
pub enum CampaignError {
    #[msg("Invalid amount provided")]
    InvalidAmount,

    #[msg("Campaign is not active")]
    CampaignNotActive,

    #[msg("All packs have been sold")]
    SoldOut,

    #[msg("You do not own this pack")]
    NotPackOwner,

    #[msg("This pack has already been claimed")]
    AlreadyClaimed,

    #[msg("Invalid Merkle proof")]
    InvalidProof,

    #[msg("Token mint does not match campaign")]
    InvalidMint,

    #[msg("Invalid mint authority")]
    InvalidMintAuthority,

    #[msg("Unauthorized action")]
    Unauthorized,

    #[msg("Insufficient funds")]
    InsufficientFunds,
}
