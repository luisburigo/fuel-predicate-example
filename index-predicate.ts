import { launchTestNode } from 'fuels/test-utils';
import { PredicateTest } from "./artifacts";
import { ethers } from 'ethers';
import {Address, arrayify, BN, bn, calculateGasFee, type BytesLike, concat, Provider, ScriptTransactionRequest, transactionRequestify, ZeroBytes32, WalletUnlocked, Wallet} from 'fuels';
import { stringToHex } from 'viem';
import type { HDNodeWallet } from 'ethers';
import { bakoCoder, SignatureType } from './coders';

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
  request.addWitness(compactSignature);
  return request;
}

const signTransactionFUEL = async (wallet: WalletUnlocked, request: ScriptTransactionRequest, chainID: number) => {
  const txId = request.getTransactionId(chainID);
  const signature = await wallet.signMessage(txId.slice(2));
  const compactSignature = bakoCoder.encode({
      type: SignatureType.Fuel,
      signature,
  });
  request.addWitness(compactSignature);
  return request;
}

try {
    using node = await launchTestNode();
    const {wallets: [wallet], provider} = node;

    const chainID = await provider.getChainId();
    const evmWallet = ethers.Wallet.createRandom();
    const baseAssetId = await provider.getBaseAssetId();    

    const evmWalletAddress = new Address(evmWallet.address).toString();
    const fuelWalletAddress = wallet.address.toString();

    // Create the EVM predicate instance
    let evmPredicate = new PredicateTest({
        data: [],
        configurableConstants: {
            SIGNER: [evmWalletAddress, fuelWalletAddress]
        },
        provider,
    });

    // Transfer some funds to the EVM predicate
    const fundRequest = await wallet.transfer(evmPredicate.address, bn(100_000_000));
    await fundRequest.waitForResult();

    // Create a transaction to send fund from EVM Predicate to the wallet
    let transaction = new ScriptTransactionRequest({})
    transaction.addCoinOutput(wallet.address, bn(10), baseAssetId);
    transaction.addChangeOutput(evmPredicate.address, baseAssetId);

    const resources = await evmPredicate.getResourcesToSpend([{
        amount: bn(100_000),
        assetId: baseAssetId,
    }]);
    transaction.addResources(resources);

    // Prepare the transaction, estimate the gas and fee
    const { request } = await prepareTransaction(transaction, evmPredicate, chainID);
    transaction = request as ScriptTransactionRequest;

    // Sign the transaction
    transaction = await signTransactionEVM(evmWallet, transaction, chainID);
    transaction = await signTransactionFUEL(wallet, transaction, chainID);
    transaction = await provider.estimatePredicates(transaction);

    // Send the transaction
    const response = await evmPredicate.sendTransaction(transaction);
    const result = await response.waitForResult();

    console.log("TX executed:", result.id);
} catch (e) {
    console.log(e.message);
}

async function prepareTransaction(
    transaction: ScriptTransactionRequest,
    predicate: PredicateTest,
    chainId: number,
  ) {
    const transactionRequest = transactionRequestify(transaction);
    const transactionFee = transactionRequest.maxFee.toNumber();
    const predicateSignatureIndex = getMockedSignatureIndex(
      transactionRequest.witnesses,
    );

    // To each input of the request, attach the predicate and its data
    const requestWithPredicateAttached =
      predicate.populateTransactionPredicateData(transactionRequest);

    const maxGasUsed =
      await getMaxPredicateGasUsed(predicate.provider);

    let predictedGasUsedPredicate = bn(0);
    requestWithPredicateAttached.inputs.forEach((input) => {
      if ('predicate' in input && input.predicate) {
        input.witnessIndex = 0;
        predictedGasUsedPredicate = predictedGasUsedPredicate.add(maxGasUsed);
      }
    });

    // Add a placeholder for the predicate signature to count on bytes measurement from start. It will be replaced later
    requestWithPredicateAttached.witnesses[predicateSignatureIndex] = concat([
      ZeroBytes32,
      ZeroBytes32,
    ]);

    const { gasPriceFactor } = await predicate.provider.getGasConfig();
    const { maxFee, gasPrice } = await predicate.provider.estimateTxGasAndFee({
      transactionRequest: requestWithPredicateAttached,
    });

    const predicateSuccessFeeDiff = calculateGasFee({
      gas: predictedGasUsedPredicate,
      priceFactor: gasPriceFactor,
      gasPrice,
    });

    const feeWithFat = maxFee.add(predicateSuccessFeeDiff);
    const isNeededFatFee = feeWithFat.gt(transactionFee);

    if (isNeededFatFee) {
      // add more 10 just in case sdk fee estimation is not accurate
      requestWithPredicateAttached.maxFee = feeWithFat.add(10);
    }

    // Attach missing inputs (including estimated predicate gas usage) / outputs to the request
    await predicate.provider.estimateTxDependencies(
      requestWithPredicateAttached,
    );

    return {
      predicate,
      request: requestWithPredicateAttached,
      transactionId: requestWithPredicateAttached.getTransactionId(chainId),
      transactionRequest,
    };
}

async function getMaxPredicateGasUsed(provider: Provider): Promise<BN> {
const fakeAccountEVM = ethers.Wallet.createRandom();
const fakeAccountFUEL = Wallet.generate();
const chainId = await provider.getChainId();
const fakePredicate = new PredicateTest({
    data: [],
    configurableConstants: {
        SIGNER: [new Address(fakeAccountEVM.address).toString(), fakeAccountFUEL.address.toString()]
    },
    provider,
});
let request = new ScriptTransactionRequest();
request.addCoinInput({
    id: ZeroBytes32,
    assetId: ZeroBytes32,
    amount: bn(),
    owner: fakePredicate.address,
    blockCreated: bn(),
    txCreatedIdx: bn(),
});
fakePredicate.populateTransactionPredicateData(request);
//
request = await signTransactionEVM(fakeAccountEVM, request, chainId);
request = await signTransactionFUEL(fakeAccountFUEL, request, chainId);
//
await fakePredicate.provider.estimatePredicates(request);
const predicateInput = request.inputs[0];
if (predicateInput && 'predicate' in predicateInput) {
    return bn(predicateInput.predicateGasUsed);
}

return bn();
}