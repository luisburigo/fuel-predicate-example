import {ethers, Signature} from "ethers";
import { launchTestNode } from "fuels/test-utils";
import {EvmScript} from "./artifacts";
import {Address, randomBytes, sha256} from "fuels";

try {
    const evmWallet = ethers.Wallet.createRandom();

    using node = await launchTestNode({});
    const {wallets: [fuelWallet], provider} = node;

    const evmScript = new EvmScript(fuelWallet);
    evmScript.setConfigurableConstants({
        SIGNER: Address.fromEvmAddress(evmWallet.address).toString()
    });

    const transactionRequest = evmScript.functions.main(0);
    const txId = await transactionRequest.getTransactionId();
    console.log(`Transaction ID: ${txId}`);

    const signature = await evmWallet.signMessage(txId);
    const compactSignature = Signature.from(signature).compactSerialized;

    let request = await transactionRequest.getTransactionRequest();
    request.addWitness(compactSignature);
    request = await request.estimateAndFund(fuelWallet);

    const response = await fuelWallet.sendTransaction(request);
    const {logs, receipts} = await response.waitForResult({
        main: EvmScript.abi
    });

    console.log('Is executed?', {
        receipts
    })
} catch (error) {
    console.error(error);
}