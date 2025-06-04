import {launchTestNode} from 'fuels/test-utils';
import {PredicateTest, ScriptTest} from "./artifacts";

try {
    using node = await launchTestNode();
    const {wallets: [wallet], provider} = node;

    const predicateTest = new PredicateTest({
        data: [10],
        configurableConstants: {
            SECRET_NUMBER: 10
        },
        provider,
    });

    console.log(predicateTest.address.toString())

    const scriptTransactionRequest1 = await wallet.transfer(predicateTest.address, 1000);
    await scriptTransactionRequest1.waitForResult();

    const initialBalance = await predicateTest.getBalance();
    console.log('Initial Predicate Balance:', initialBalance.toString());

    const scriptTransactionRequest = await predicateTest.createTransfer(wallet.address, 100);
    scriptTransactionRequest.witnesses = [
        // assinar a tx com a evm
    ]
    const transactionResponse = await predicateTest.sendTransaction(scriptTransactionRequest);
    await transactionResponse.waitForResult();

    const finalBalance = await predicateTest.getBalance();
    console.log('Final Predicate Balance:', finalBalance.toString());

    const scriptTest = new ScriptTest(wallet);
    scriptTest.setConfigurableConstants({
        SECRET_NUMBER: 10
    });

    const scriptTx = await scriptTest.functions.main(10).call();
    const {value, logs} = await scriptTx.waitForResult();

    console.log('Script result:', value);
    console.log('Script logs:', logs.map(log => log.toString()));
} catch (e) {
    console.log(e.message);
}
