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

import { Allocation, Asset, Params, Participant, State } from "./Channel";

const zeroAddress = "0x0000000000000000000000000000000000000000";

describe("Adjudicator Multi-Ledger Qualification", function () {
    async function makeParticipants(): Promise<Participant[]> {
        const signers = await ethers.getSigners();
        return [
            new Participant(await signers[1].getAddress(), zeroAddress),
            new Participant(await signers[2].getAddress(), zeroAddress),
        ];
    }

    function makeState(
        params: Params,
        assets: Asset[],
        backends: number[]
    ): State {
        const balances = assets.map(() => ["10", "20"]);
        const outcome = new Allocation(assets, backends, balances, []);
        return new State(params.channelID(), "0", outcome, "0x", false);
    }

    it("classifies single-ledger channels as not multi-ledger", async () => {
        const harness = await ethers.deployContract("MultiLedgerHarness");
        await harness.waitForDeployment();

        const participants = await makeParticipants();
        const params = new Params(ethers.ZeroAddress, 60, "1", participants, true);
        const singleAsset = new Asset(1337, ethers.ZeroAddress, zeroAddress);
        const state = makeState(params, [singleAsset], [1]);

        const isMultiLedger = await harness.isMultiLedgerStateHarness(state.serialize());
        expect(isMultiLedger).to.equal(false);
    });

    it("classifies distinct ledger identities as multi-ledger", async () => {
        const harness = await ethers.deployContract("MultiLedgerHarness");
        await harness.waitForDeployment();

        const participants = await makeParticipants();
        const params = new Params(ethers.ZeroAddress, 60, "2", participants, true);
        const assetA = new Asset(1337, ethers.ZeroAddress, zeroAddress);
        const assetB = new Asset(1, ethers.ZeroAddress, zeroAddress);
        const state = makeState(params, [assetA, assetB], [1, 1]);

        const isMultiLedger = await harness.isMultiLedgerStateHarness(state.serialize());
        expect(isMultiLedger).to.equal(true);
    });

    it("does not classify repeated same ledger identities as multi-ledger", async () => {
        const harness = await ethers.deployContract("MultiLedgerHarness");
        await harness.waitForDeployment();

        const participants = await makeParticipants();
        const params = new Params(ethers.ZeroAddress, 60, "3", participants, true);
        const assetA = new Asset(1337, ethers.ZeroAddress, zeroAddress);
        const assetB = new Asset(1337, ethers.ZeroAddress, zeroAddress);
        const state = makeState(params, [assetA, assetB], [1, 1]);

        const isMultiLedger = await harness.isMultiLedgerStateHarness(state.serialize());
        expect(isMultiLedger).to.equal(false);
    });

    it("keeps coordinator-enabled qualification distinct from plain multi-ledger detection", async () => {
        const harness = await ethers.deployContract("MultiLedgerHarness");
        await harness.waitForDeployment();

        const signers = await ethers.getSigners();
        const coordinator = await signers[3].getAddress();
        const participants = await makeParticipants();

        const assetA = new Asset(1337, ethers.ZeroAddress, zeroAddress);
        const assetB = new Asset(1, ethers.ZeroAddress, zeroAddress);

        const noCoordinatorParams = new Params(
            ethers.ZeroAddress,
            60,
            "4",
            participants,
            true,
            ethers.ZeroAddress
        );
        const noCoordinatorState = makeState(noCoordinatorParams, [assetA, assetB], [1, 1]);
        const noCoordinatorEligible = await harness.isCoordinatedEligibleHarness(
            noCoordinatorParams.serialize(),
            noCoordinatorState.serialize()
        );
        expect(noCoordinatorEligible).to.equal(false);

        const withCoordinatorParams = new Params(
            ethers.ZeroAddress,
            60,
            "5",
            participants,
            true,
            coordinator
        );
        const withCoordinatorState = makeState(withCoordinatorParams, [assetA, assetB], [1, 1]);
        const withCoordinatorEligible = await harness.isCoordinatedEligibleHarness(
            withCoordinatorParams.serialize(),
            withCoordinatorState.serialize()
        );
        expect(withCoordinatorEligible).to.equal(true);

        const singleLedgerWithCoordinator = makeState(withCoordinatorParams, [assetA], [1]);
        const singleLedgerEligible = await harness.isCoordinatedEligibleHarness(
            withCoordinatorParams.serialize(),
            singleLedgerWithCoordinator.serialize()
        );
        expect(singleLedgerEligible).to.equal(false);
    });
});
