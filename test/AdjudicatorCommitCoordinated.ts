// Copyright 2026 - See NOTICE file for copyright holders.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256 } from "ethers";

import { Adjudicator, Adjudicator__factory } from "../typechain-types";
import { sign } from "../src/lib/web3";
import { Allocation, Asset, Params, Participant, State, DisputePhase } from "./Channel";

const zeroAddress = "0x0000000000000000000000000000000000000000";

describe("Adjudicator commitCoordinated", function () {
    let adjudicator: Adjudicator;
    let participants: Participant[];
    let coordinator: string;
    let otherCoordinator: string;
    let chainID: number;

    beforeEach(async () => {
        const signers = await ethers.getSigners();
        participants = [
            new Participant(await signers[1].getAddress(), zeroAddress),
            new Participant(await signers[2].getAddress(), zeroAddress),
        ];
        coordinator = await signers[3].getAddress();
        otherCoordinator = await signers[4].getAddress();

        chainID = Number((await ethers.provider.getNetwork()).chainId);

        const factory = await ethers.getContractFactory("Adjudicator") as Adjudicator__factory;
        adjudicator = await factory.deploy();
        await adjudicator.waitForDeployment();
    });

    function makeParams(coordinatorAddress: string): Params {
        return new Params(zeroAddress, 60, "123", participants, true, coordinatorAddress);
    }

    function makeState(params: Params, version: number, assetCount: 1 | 2): State {
        const assets =
            assetCount === 1
                ? [new Asset(chainID, zeroAddress, "0x")]
                : [
                    new Asset(chainID, zeroAddress, "0x"),
                    new Asset(chainID + 1, zeroAddress, "0x"),
                ];

        const backends = assetCount === 1 ? [1] : [1, 2];
        const balances = assetCount === 1 ? [["7", "11"]] : [["7", "11"], ["13", "17"]];

        return new State(
            params.channelID(),
            version.toString(),
            new Allocation(assets, backends, balances, []),
            "0x00",
            true
        );
    }

    async function concludeFinal(params: Params, state: State): Promise<void> {
        const participantSigs = await state.sign(params.participants);
        await adjudicator.concludeFinal(params.serialize(), state.serialize(), participantSigs);
    }

    async function signCoordinatorState(state: State, signerAddress: string): Promise<string> {
        return sign(state.encode(), signerAddress);
    }

    it("transitions Concluded to Coordinated on valid coordinated commit", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 1, 2);
        await concludeFinal(params, concludedState);

        const canonicalState = makeState(params, 1, 2);
        const participantSigs = await canonicalState.sign(params.participants);
        const coordSig = await signCoordinatorState(canonicalState, coordinator);

        await adjudicator.commitCoordinated(
            params.serialize(),
            canonicalState.serialize(),
            participantSigs,
            coordSig
        );

        const dispute = await adjudicator.disputes(canonicalState.channelID);
        expect(Number(dispute.phase)).to.equal(DisputePhase.COORDINATED);
        expect(Number(dispute.version)).to.equal(1);
    });

    it("overwrites stale local state with fresher canonical version", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 1, 2);
        await concludeFinal(params, concludedState);

        const fresherCanonical = makeState(params, 2, 2);
        const participantSigs = await fresherCanonical.sign(params.participants);
        const coordSig = await signCoordinatorState(fresherCanonical, coordinator);

        await adjudicator.commitCoordinated(
            params.serialize(),
            fresherCanonical.serialize(),
            participantSigs,
            coordSig
        );

        const dispute = await adjudicator.disputes(fresherCanonical.channelID);
        expect(Number(dispute.phase)).to.equal(DisputePhase.COORDINATED);
        expect(Number(dispute.version)).to.equal(2);
        expect(dispute.stateHash).to.equal(keccak256(fresherCanonical.encode()));
    });

    it("rejects lower-version canonical states", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 2, 2);
        await concludeFinal(params, concludedState);

        const staleCanonical = makeState(params, 1, 2);
        const participantSigs = await staleCanonical.sign(params.participants);
        const coordSig = await signCoordinatorState(staleCanonical, coordinator);

        await expect(
            adjudicator.commitCoordinated(
                params.serialize(),
                staleCanonical.serialize(),
                participantSigs,
                coordSig
            )
        ).to.be.revertedWith("invalid version");
    });

    it("rejects invalid participant witness signatures", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 1, 2);
        await concludeFinal(params, concludedState);

        const canonicalState = makeState(params, 1, 2);
        const invalidParticipantSigs = await canonicalState.sign([params.participants[0]]);
        const coordSig = await signCoordinatorState(canonicalState, coordinator);

        await expect(
            adjudicator.commitCoordinated(
                params.serialize(),
                canonicalState.serialize(),
                invalidParticipantSigs,
                coordSig
            )
        ).to.be.reverted;
    });

    it("rejects invalid coordinator signatures", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 1, 2);
        await concludeFinal(params, concludedState);

        const canonicalState = makeState(params, 1, 2);
        const participantSigs = await canonicalState.sign(params.participants);
        const wrongCoordSig = await signCoordinatorState(canonicalState, otherCoordinator);

        await expect(
            adjudicator.commitCoordinated(
                params.serialize(),
                canonicalState.serialize(),
                participantSigs,
                wrongCoordSig
            )
        ).to.be.revertedWith("invalid signature");
    });

    it("rejects missing or wrong coordinator identity", async () => {
        const paramsMissingCoordinator = makeParams(zeroAddress);
        const concludedState = makeState(paramsMissingCoordinator, 1, 2);
        await concludeFinal(paramsMissingCoordinator, concludedState);

        const canonicalState = makeState(paramsMissingCoordinator, 1, 2);
        const participantSigs = await canonicalState.sign(paramsMissingCoordinator.participants);
        const coordSig = await signCoordinatorState(canonicalState, coordinator);

        await expect(
            adjudicator.commitCoordinated(
                paramsMissingCoordinator.serialize(),
                canonicalState.serialize(),
                participantSigs,
                coordSig
            )
        ).to.be.revertedWith("incorrect phase");
    });

    it("rejects coordinated commit for single-ledger channels", async () => {
        const params = makeParams(coordinator);
        const concludedState = makeState(params, 1, 1);
        await concludeFinal(params, concludedState);

        const canonicalState = makeState(params, 1, 1);
        const participantSigs = await canonicalState.sign(params.participants);
        const coordSig = await signCoordinatorState(canonicalState, coordinator);

        await expect(
            adjudicator.commitCoordinated(
                params.serialize(),
                canonicalState.serialize(),
                participantSigs,
                coordSig
            )
        ).to.be.revertedWith("incorrect phase");
    });
});
