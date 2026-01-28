use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface},
};

use crate::{
    error::CampaignError,
    states::{Campaign, Receipt},
    utils::merkle::{create_leaf, verify_proof},
};

#[derive(Accounts)]
pub struct ClaimPack<'info> {
    #[account(
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"receipt", campaign.key().as_ref(), &receipt.pack_index.to_le_bytes()],
        bump,
        constraint = receipt.buyer == buyer.key() @ CampaignError::NotPackOwner,
        constraint = !receipt.is_claimed @ CampaignError::AlreadyClaimed,
    )]
    pub receipt: Account<'info, Receipt>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        mint::token_program = token_program,
        constraint = token_mint.key() == campaign.token_mint @ CampaignError::InvalidMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = token_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> ClaimPack<'info> {
    pub fn claim_pack(
        &mut self,
        token_amount: u64,
        salt: [u8; 32],
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let leaf = create_leaf(self.receipt.pack_index, token_amount, salt);

        require!(
            verify_proof(
                &proof,
                self.campaign.merkle_root,
                leaf,
                self.receipt.pack_index
            ),
            CampaignError::InvalidProof
        );

        self.mint_tokens(token_amount)?;

        self.receipt.is_claimed = true;

        Ok(())
    }

    fn mint_tokens(&self, amount: u64) -> Result<()> {
        let seed = self.campaign.seed.to_le_bytes();
        let bump = [self.campaign.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"campaign", seed.as_ref(), &bump]];

        mint_to(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                MintTo {
                    mint: self.token_mint.to_account_info(),
                    to: self.buyer_token_account.to_account_info(),
                    authority: self.campaign.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )
    }
}

pub fn handler(
    ctx: Context<ClaimPack>,
    token_amount: u64,
    salt: [u8; 32],
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    ctx.accounts.claim_pack(token_amount, salt, proof)
}
