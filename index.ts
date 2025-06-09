import { launchTestNode } from 'fuels/test-utils';
import { ScriptTest } from "./artifacts";
import { ethers, hashMessage, recoverAddress } from 'ethers';
import {Address, arrayify, bn, type BytesLike, concat, hexlify, type ScriptTransactionRequest, Wallet, WalletUnlocked} from 'fuels';
import { splitSignature } from '@ethersproject/bytes';
import { hexToBytes } from '@ethereumjs/util';
import { stringToBytes, stringToHex } from 'viem';
import type { HDNodeWallet } from 'ethers';
import { SignatureType } from './coders/coders';
import { bakoCoder } from './coders/coders';

export const getMockedSignatureIndex = (witnesses: BytesLike[]) => {
    const placeholderWitnessIndex = witnesses.findIndex(
        (item) =>
            item instanceof Uint8Array &&
            item.length === 64 &&
            item.every((value) => value === 0),
    );
    const hasPlaceholderWitness = placeholderWitnessIndex !== -1;
    // if it is a placeholder witness, we can safely replace it, otherwise we will consider a new element.
    return hasPlaceholderWitness ? placeholderWitnessIndex : witnesses.length;
};

const encodeTxIdUtf8 = (txId: string): string => {
    const txIdNo0x = txId.slice(2);
    return stringToHex(txIdNo0x);
};

const signTransactionEVM = async (wallet: HDNodeWallet, request: ScriptTransactionRequest, chainID: number) => {
    const txId = request.getTransactionId(chainID);
    const message = encodeTxIdUtf8(txId);
    const signature = await wallet.signMessage(arrayify(message));
    const compactSignature = bakoCoder.encode({
        type: SignatureType.EVM,
        signature,
    });
    request.witnesses.push(compactSignature);
    return request;
}

const signTransactionFUEL = async (wallet: WalletUnlocked, request: ScriptTransactionRequest) => {
    const signature = await wallet.signTransaction(request);
    const compactSignature = bakoCoder.encode({
        type: SignatureType.Fuel,
        signature,
    });
    request.witnesses.push(compactSignature);
    return request;
}

try {
    using node = await launchTestNode({
        walletsConfig: {
            amountPerCoin: bn(1_000_000_000)
        }
    });
    const {wallets: [wallet], provider} = node;

    const chainID = await provider.getChainId();
    const evmWallet = ethers.Wallet.createRandom();

    const balance = await wallet.getBalance();
    console.log(balance.toString());

    const evmWalletAddress = new Address(evmWallet.address).toString();
    const fuelWalletAddress = wallet.address.toString();

    const scriptTest = new ScriptTest(wallet);
    scriptTest.setConfigurableConstants({
        SIGNER: [evmWalletAddress, fuelWalletAddress]
    });

    let request = await scriptTest.functions.main().getTransactionRequest();
    request.witnesses = [];
    request.witnesses[0] = hexlify(new Uint8Array(32).fill(1));


    // await wallet.getTransactionCost(request, {
    //     signatureCallback: async (request) => {
    //         await signTransactionEVM(evmWallet, request, chainID);
    //         await signTransactionFUEL(wallet, request);
    //         return request;
    //     }
    // });

    // request.maxFee = bn(0);
    // request.gasLimit = bn(0);

    // const resources = await wallet.getResourcesToSpend([
    //     {amount: bn(900_000_000), assetId: await provider.getBaseAssetId()}
    // ]);
    // request.addResources(resources);

    // const { assembledRequest } = await provider.assembleTx({
    //     request,
    //     feePayerAccount: wallet,
    // });

    // console.log(assembledRequest);

    // const response = await wallet.sendTransaction(request);
    // const result = await response.waitForResult();

    // console.dir(result?.logs, {depth: null});
} catch (e) {
    console.log(e.message);
}
