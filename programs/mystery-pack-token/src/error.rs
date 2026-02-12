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

    #[msg("Unauthorized action")]
    Unauthorized,

    #[msg("Insufficient funds")]
    InsufficientFunds,

    #[msg("Invalid mint authority")]
    InvalidMintAuthority,

    #[msg("Proof exceeds maximum length")]
    ProofTooLong,

    #[msg("Invalid randomness account")]
    InvalidRandomnessAccount,

    #[msg("Randomness is not ready yet")]
    RandomnessNotReady,

    #[msg("Pack has already been settled")]
    AlreadySettled,

    #[msg("Randomness slot does not match expected value")]
    RandomnessSlotMismatch,

    #[msg("No packs are available for purchase")]
    NoPacksAvailable,

    #[msg("Invalid fee recipient")]
    InvalidFeeRecipient,
}
