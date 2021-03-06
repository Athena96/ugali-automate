var AWS = require('aws-sdk');
AWS.config.update({
    region: process.env.AWS_REGION
});
var ddb = new AWS.DynamoDB.DocumentClient();

const avgSpendingKey = "avgSpendingData";
const ccSumKey = "ccSum";

exports.handler = async (event) => {
    console.log("Table: " + process.env.TRANSACTION_TABLE_NAME + " was updated...");
    console.log("DELTA: " + JSON.stringify(event));
    for (const record of event.Records) {
        // todo: pretty inefecient, getting the map every time... could cache the user map, update that...
        //      then do one update at the end for each user. (for if there's multuple txns in same category.)

        console.log("processing: " + JSON.stringify(record));
        console.log('eventName: ' + record.eventName);
        const userEmail = record.eventName === 'REMOVE' ? record.dynamodb.OldImage.user.S : record.dynamodb.NewImage.user.S;
        console.log("get avg data for user: " + userEmail);
        
        var map = await getAvgMapForUser(userEmail);
        console.log(map);

        switch (record.eventName) {
            case 'INSERT':
                const newTransaction = record.dynamodb.NewImage;
                addTransactionToAvgData(newTransaction, map);
                break;
            case 'MODIFY':
                const udpatedTransaction = record.dynamodb.NewImage;
                const previousVersion = record.dynamodb.OldImage;
                modifyTransactionToAvgData(udpatedTransaction, previousVersion, map);
                break;
            case 'REMOVE':
                const transactionToRemove = record.dynamodb.OldImage;
                removeTransactionToAvgData(transactionToRemove, map);
                break;
            default:
              console.log(`error`);
              return;
        }
        console.log('updated map: ' + JSON.stringify(map));
        await putMapForUser(map);
    }
};

async function getAvgMapForUser(userEmail) {
    try {
        var params = {
            TableName: process.env.AVGDATA_TABLE_NAME,
            Key: {
                "user": userEmail
            }
        };
        const result = await ddb.get(params).promise();
        console.log(JSON.stringify(result));
        if (Object.keys(result).length === 0 ) {
            console.log('empty obj');
           return {
            "user":  userEmail,
            avgSpendingKey: { }
            } 
        } else {
            return result.Item;
        }
    } catch (err) {
        console.log(err);
        return {
            "user":  userEmail,
            avgSpendingKey: { }
        };
    }
};

async function putMapForUser(map) {
    var params = {
        Item: map,
        TableName: process.env.AVGDATA_TABLE_NAME
    };
    const result = await ddb.put(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else console.log(data); // successful response
    }).promise();

    console.log("put restuls: " + JSON.stringify(result));
    return result;
};


function initMap(transaction, map) {
    const year = getYearFrom(transaction);
    const month = getMonthFrom(transaction);
    const category = transaction.category.S;
    if (map[avgSpendingKey][year] === undefined) {
        console.log("no year, adding year to map")
        map[avgSpendingKey][year] = {
        };
    }
    if (map[avgSpendingKey][year][month] === undefined) {
        console.log("no month, adding month to map")

        map[avgSpendingKey][year][month] = {
            ccSum: 0.0
        };
    }
    if (map[avgSpendingKey][year][month][category] === undefined) {
        console.log("no category, adding category to map")
        map[avgSpendingKey][year][month][category] = {
            count: 0,
            sum: 0.0
        };
    }

    initCCSumField(transaction, map);
}

function initCCSumField(transaction, map) {
    const year = getYearFrom(transaction);
    const month = getMonthFrom(transaction);
    if (map[avgSpendingKey][year][month][ccSumKey] === undefined) {
        console.log("adding cc sum field to existing mo/yr");
        map[avgSpendingKey][year][month][ccSumKey] = 0.0;
    }
}
function addTransactionToAvgData(newTransaction, map) {
    console.log("addTransactionToAvgData");
    console.log(newTransaction);
    const year = getYearFrom(newTransaction);
    const month = getMonthFrom(newTransaction);
    console.log(year, month);

    initMap(newTransaction, map);

    map[avgSpendingKey][year][month][newTransaction.category.S].count += 1;
    map[avgSpendingKey][year][month][newTransaction.category.S].sum += parseFloat(newTransaction.amount.N);

    if (isCCExpense(newTransaction)) {
        console.log("increment sum data if cc txn");
        console.log(JSON.stringify(newTransaction));
        map[avgSpendingKey][year][month][ccSumKey] += parseFloat(newTransaction.amount.N);
    }
};

function modifyTransactionToAvgData(udpatedTransaction, previousVersion, map) {
    console.log("modifyTransactionToAvgData");
    console.log("previousVersion" + JSON.stringify(previousVersion));
    console.log("udpatedTransaction" + JSON.stringify(udpatedTransaction));
    const prevYear = getYearFrom(previousVersion);
    const prevMonth = getMonthFrom(previousVersion);
    const updatedYear = getYearFrom(udpatedTransaction);
    const updatedMonth = getMonthFrom(udpatedTransaction);

    console.log("subtract amount and count from the previous entry");
    map[avgSpendingKey][prevYear][prevMonth][previousVersion.category.S].sum -= parseFloat(previousVersion.amount.N);
    map[avgSpendingKey][prevYear][prevMonth][previousVersion.category.S].count -= 1;

    // if the resulting count is 0... then the user likely created a new category by accident... 
    // so remove it from the map to keep things clean.
    if (map[avgSpendingKey][prevYear][prevMonth][previousVersion.category.S].count === 0) {
        delete map[avgSpendingKey][prevYear][prevMonth][previousVersion.category.S];
    }

    initMap(udpatedTransaction, map);
    initCCSumField(previousVersion, map);

    map[avgSpendingKey][updatedYear][updatedMonth][udpatedTransaction.category.S].count += 1;
    map[avgSpendingKey][updatedYear][updatedMonth][udpatedTransaction.category.S].sum += parseFloat(udpatedTransaction.amount.N);

    if (isCCExpense(previousVersion) && isCCExpense(udpatedTransaction)) {
        console.log("isCCExpense(previousVersion) && isCCExpense(udpatedTransaction)");
        map[avgSpendingKey][prevYear][prevMonth][ccSumKey] -= parseFloat(previousVersion.amount.N);
        map[avgSpendingKey][updatedYear][updatedMonth][ccSumKey] += parseFloat(udpatedTransaction.amount.N);
    } else if (!isCCExpense(previousVersion) && isCCExpense(udpatedTransaction)) {
        console.log("!isCCExpense(previousVersion) && isCCExpense(udpatedTransaction)");
        map[avgSpendingKey][updatedYear][updatedMonth][ccSumKey] += parseFloat(udpatedTransaction.amount.N);
    } else if (isCCExpense(previousVersion) && !isCCExpense(udpatedTransaction)) {
        console.log("!isCCExpense(previousVersion) && isCCExpense(udpatedTransaction)");
        map[avgSpendingKey][prevYear][prevMonth][ccSumKey] -= parseFloat(udpatedTransaction.amount.N);
    }
};

function removeTransactionToAvgData(transactionToRemove, map) {
    console.log("removeTransactionToAvgData");
    const year = getYearFrom(transactionToRemove);
    const month = getMonthFrom(transactionToRemove);
    map[avgSpendingKey][year][month][transactionToRemove.category.S].count -= 1;
    map[avgSpendingKey][year][month][transactionToRemove.category.S].sum -= parseFloat(transactionToRemove.amount.N);

    if (isCCExpense(transactionToRemove)) {
        console.log("remove sum data");
        console.log(JSON.stringify(transactionToRemove));
        if (map[avgSpendingKey][year][month][ccSumKey] !== undefined) {
            let currVal = map[avgSpendingKey][year][month][ccSumKey];
            console.log(currVal);
            console.log(typeof currVal);
            let newVal = currVal -= parseFloat(transactionToRemove.amount.N);
            console.log("newVal: " + newVal);
            if (newVal >= 0) {
                map[avgSpendingKey][year][month][ccSumKey] -= parseFloat(transactionToRemove.amount.N);
            }
        }
    }
};

function getYearFrom(transaction) {
    return transaction.date.S.split('-')[0];
}

function getMonthFrom(transaction) {
    return transaction.date.S.split('-')[1];
}

function isCCExpense(transaction) {
    return transaction.payment_method.S === "credit" && transaction.type.N === "2";
}