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

// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.15;
pragma abicoder v2;

import "./Channel.sol";

library MultiLedger {
    function isCoordinatorConfigured(
        Channel.Params memory params
    ) internal pure returns (bool) {
        return params.coordinator != address(0);
    }

    function isMultiLedgerState(
        Channel.State memory state
    ) internal pure returns (bool) {
        Channel.Allocation memory outcome = state.outcome;
        uint256 assetsLen = outcome.assets.length;
        if (assetsLen <= 1) {
            return false;
        }

        require(
            outcome.backends.length == assetsLen,
            "backends length mismatch"
        );

        uint256 firstBackend = outcome.backends[0];
        uint256 firstChainID = outcome.assets[0].chainID;
        for (uint256 i = 1; i < assetsLen; ++i) {
            if (
                outcome.backends[i] != firstBackend ||
                outcome.assets[i].chainID != firstChainID
            ) {
                return true;
            }
        }

        return false;
    }

    function isCoordinatedEligible(
        Channel.Params memory params,
        Channel.State memory state
    ) internal pure returns (bool) {
        return isCoordinatorConfigured(params) && isMultiLedgerState(state);
    }
}
