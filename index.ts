import { launchTestNode } from 'fuels/test-utils';
import { ScriptTest } from "./artifacts";
import { ethers, hashMessage, recoverAddress } from 'ethers';
import {Address, arrayify, bn, type BytesLike, concat, hexlify, type ScriptTransactionRequest} from 'fuels';
import { splitSignature } from '@ethersproject/bytes';
import { hexToBytes } from '@ethereumjs/util';
import { stringToBytes, stringToHex } from 'viem';
import type { HDNodeWallet } from 'ethers';

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

const signTransaction = async (wallet: HDNodeWallet, request: ScriptTransactionRequest, chainID: number) => {
    const txId = request.getTransactionId(chainID);
    const message = encodeTxIdUtf8(txId);
    const signature = await wallet.signMessage(arrayify(message));
    const compactSignature = splitSignature(hexToBytes(signature)).compact;
    request.witnesses[0] = compactSignature;
    return request;
}

try {
    using node = await launchTestNode();
    const {wallets: [wallet], provider} = node;

    const chainID = await provider.getChainId();
    const evmWallet = ethers.Wallet.createRandom();
    const evmWalletAddress = new Address(evmWallet.address).toString();

    const scriptTest = new ScriptTest(wallet);
    scriptTest.setConfigurableConstants({
        SIGNER: evmWalletAddress
    });

    let request = await scriptTest.functions.main(0).getTransactionRequest();
    request.witnesses[0] = new Uint8Array(64); 
    
    const { assembledRequest } = await provider.assembleTx({
        request,
        feePayerAccount: wallet,
        reserveGas: bn(10000)
      });

    request = await provider.estimatePredicates(assembledRequest);
    request = await signTransaction(evmWallet, request, chainID);

    const response = await wallet.sendTransaction(request);
    const result = await response.waitForResult();

    console.dir(result?.logs, {depth: null});
} catch (e) {
    console.log(e.message);
}
