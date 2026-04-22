# Coordinated Settlement Phase 1 Design

## Scope

This document finalizes the Phase 1 ABI and state-machine mapping for coordinated multi-ledger settlement. It is intentionally limited to design decisions and does not introduce executable contract logic.

## Current Contract Baseline

- Current dispute phases are `DISPUTE`, `FORCEEXEC`, `CONCLUDED`.
- Existing transitions are driven by `register`, `progress`, `conclude`, and `concludeFinal`.
- State signatures are currently verified against `Channel.encodeState(state)` via `Sig.verify`.
- Existing `Dispute` storage keeps `version`, `stateHash`, timeout metadata, and app flag, but not participant signatures.

## Finalized Phase Entry and Exit Conditions

### `Concluded -> Coordinated`

The transition is allowed only when all checks pass:

1. Channel is coordinated-eligible multi-ledger.
2. Coordinator identity is configured in channel params.
3. Current dispute phase is `CONCLUDED`.
4. Submitted canonical state belongs to the same channel (`state.channelID == channelID(params)`).
5. Canonical state is structurally valid under current adjudicator checks.
6. Participant witness verification succeeds for canonical state.
7. Coordinator signature verification succeeds for canonical state.
8. Submitted canonical version `v* >= vChain`.
9. If `v* > vChain`, overwrite stale on-chain dispute state with canonical state before entering `COORDINATED`.

### `Coordinated -> Withdrawing`

The withdrawal path for coordinated multi-ledger channels is allowed only if phase is `COORDINATED`.

Single-ledger and non-coordinator channels retain their legacy withdrawal path semantics.

## Multi-Ledger Detection Rule (On-Chain Equivalent)

The on-chain detector should classify as multi-ledger only when allocation assets represent more than one distinct ledger identity.

For this Solidity layout, the closest equivalent key is derived per asset from:

- backend identifier from `state.outcome.backends[i]`
- ledger identity from `state.outcome.assets[i].chainID`

A channel is multi-ledger when there are at least two distinct `(backend, chainID)` keys across assets.

This avoids the unsafe shortcut of using only asset count.

## Coordinator Identity Source

Coordinator identity is stored in `Channel.Params` via an additive params extension.

Design intent:

- coordinator identity remains channel-scoped and immutable by channel ID derivation
- adjudicator reads coordinator identity from the submitted params after `requireValidParams(params, state)`

## Signature Verification Reuse

Coordinator signature verification must reuse the existing state-signature semantics:

- payload: `Channel.encodeState(canonicalState)`
- verifier: `Sig.verify(...)`

No custom coordinator signing domain and no perunio preimage logic are introduced on-chain.

## Participant Witness Verification Feasibility and ABI Outcome

### Finding

The baseline signature shape:

`commitCoordinated(Channel.Params params, Channel.State canonicalState, bytes coordSig)`

is insufficient to safely verify participant witness requirements for canonical state updates beyond already-stored hash/version.

Reason:

- current dispute storage does not persist participant signatures
- current storage only stores `stateHash` and version metadata
- therefore canonical state witness material cannot be reconstructed from storage

### Final ABI Decision

Use minimal additive witness-carrying method shape:

`commitCoordinated(Channel.Params params, Channel.State canonicalState, bytes[] participantSigs, bytes coordSig)`

This keeps coordinator signature semantics unchanged and mirrors existing witness verification style already used in register/concludeFinal.

## Event Design Decision

Add dedicated event:

`event Coordinated(bytes32 indexed channelID, uint64 version, uint64 timeout);`

`ChannelUpdate` remains unchanged for legacy flows.

## Expected Contract Surface Delta (Phase 1 Mapping)

- `DisputePhase`: add `COORDINATED`.
- `Channel.Params`: add coordinator identity field.
- Adjudicator: add `commitCoordinated(...)` entrypoint.
- Adjudicator: add coordinated-only withdrawal branch for coordinator-enabled multi-ledger channels.
- Adjudicator: emit dedicated `Coordinated(...)` event on successful coordinated transition.

## Backward-Compatibility Notes

- Params schema extension changes channel ID derivation for newly created channels under this branch.
- Legacy single-ledger behavior is preserved by branch-specific guards.
- Existing state-signature path is reused to avoid backend semantic drift.

## Risks to Carry Into Phase 2+

1. Test fixtures and tuple serializers must be updated consistently with params schema extension.
2. Dispute tuple/enum expectations in tests must be adjusted when phase enum is extended.
3. ABI regeneration and typechain updates are required after implementation phases, not in this design-only phase.
