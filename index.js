import axios from 'axios';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Load payloads from JSON file
const payloads = JSON.parse(fs.readFileSync('payloads.json', 'utf-8'));

// MAIN API
const mainApiUrl = 'https://deployment-hp4y88pxnqxwlmpxllicjzzn.stag-vxzy.zettablock.com/main';

// TTFT API
const ttftApiUrl = 'https://quests-usage-dev.prod.zettablock.com/api/ttft';

// REPORT USAGE API
const reportUsageApiUrl = 'https://quests-usage-dev.prod.zettablock.com/api/report_usage';

// Function to calculate time difference in milliseconds
const calculateTimeDifference = (startTime, endTime) => {
  return endTime - startTime;
};

// Function to send request to MAIN API
const sendMainApiRequest = async (message) => {
  const startTime = Date.now();
  try {
    const response = await axios.post(mainApiUrl, { message, stream: true }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      responseType: 'stream'
    });

    let responseData = '';
    response.data.on('data', (chunk) => {
      const chunkStr = chunk.toString();

      // Split the chunk by newline to handle multiple JSON objects
      const lines = chunkStr.split('\n');
      for (const line of lines) {
        if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;

        try {
          // Remove "data: " prefix and parse JSON
          const jsonStr = line.replace('data: ', '').trim();
          if (jsonStr) {
            const jsonData = JSON.parse(jsonStr);
            if (jsonData.choices[0].delta.content) {
              responseData += jsonData.choices[0].delta.content;
            }
          }
        } catch (error) {
          console.error('Error parsing chunk:', error);
          console.error('Chunk content:', line);
        }
      }
    });

    return new Promise((resolve) => {
      response.data.on('end', () => {
        const endTime = Date.now();
        const timeToFirstToken = calculateTimeDifference(startTime, endTime);
        resolve({ responseData, timeToFirstToken });
      });
    });
  } catch (error) {
    console.error('Error in MAIN API request:', error);
  }
};

// Function to send request to TTFT API
const sendTtftApiRequest = async (timeToFirstToken) => {
  const ttftPayload = {
    deployment_id: "deployment_Hp4Y88pxNQXwLMPxlLICJZzN",
    time_to_first_token: timeToFirstToken
  };

  try {
    const response = await axios.post(ttftApiUrl, ttftPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data.message;
  } catch (error) {
    console.error('Error in TTFT API request:', error);
  }
};

// Function to send request to REPORT USAGE API
const sendReportUsageApiRequest = async (walletAddress, requestText, responseText) => {
  const reportUsagePayload = {
    wallet_address: walletAddress,
    agent_id: "deployment_Hp4Y88pxNQXwLMPxlLICJZzN",
    request_text: requestText,
    response_text: responseText,
    request_metadata: {}
  };

  try {
    const response = await axios.post(reportUsageApiUrl, reportUsagePayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data.message;
  } catch (error) {
    console.error('Error in REPORT USAGE API request:', error);
  }
};

// Function to display welcome message
const displayWelcomeMessage = () => {
  console.log(chalk.yellow(figlet.textSync('KiteAI', { horizontalLayout: 'full', font: 'Small' })));
};

// Function to get wallets from .env
const getWallets = () => {
  dotenv.config({ path: '.env' });
  return Object.keys(process.env)
    .filter((key) => key.startsWith('WALLET_ADDRESS_'))
    .map((key) => process.env[key]);
};

// Function to add a new wallet
const addWalletMenu = async () => {
  while (true) {
    const { walletAddress } = await inquirer.prompt([
      {
        type: 'input',
        name: 'walletAddress',
        message: 'Masukkan alamat wallet baru (kosong untuk kembali):',
      }
    ]);

    if (!walletAddress.trim()) {
      console.log(chalk.yellow('⚠ Kembali ke menu utama...'));
      return;
    }

    const newKey = `WALLET_ADDRESS_${getWallets().length + 1}`;
    fs.appendFileSync('.env', `\n${newKey}=${walletAddress}`);
    dotenv.config({ path: '.env' });
    console.log(chalk.green('✅ Wallet berhasil ditambahkan!'));
  }
};

// Function to run the script for a single question and multiple wallets
const runScriptForQuestionAndWallets = async (question, selectedWallets) => {
  console.log(chalk.magenta(`\n[Question] ${question}`));

  // Send MAIN API request for the first wallet to get TTFT and REPORT USAGE responses
  const { responseData: firstResponse, timeToFirstToken } = await sendMainApiRequest(question);

  // Display TTFT and REPORT USAGE responses once
  const ttftResponse = await sendTtftApiRequest(timeToFirstToken);
  console.log(chalk.green('TTFT API Response:'), ttftResponse);

  const reportUsageResponse = await sendReportUsageApiRequest(selectedWallets[0], question, firstResponse);
  console.log(chalk.blue('REPORT USAGE API Response:'), reportUsageResponse);

  // Display Response Content for each wallet
  for (const wallet of selectedWallets) {
    const { responseData } = await sendMainApiRequest(question);
    const truncatedResponse = responseData.substring(0, 50); // Ambil 50 karakter pertama
    console.log(chalk.white(`Response Content for ${wallet}:`), truncatedResponse);
  }
};

// Function to run the script for multiple wallets
const runScriptForWallets = async (selectedWallets) => {
  console.log(chalk.cyan(`\nRunning script for Wallet Addresses: ${selectedWallets.join(', ')}`));

  for (const question of payloads) {
    await runScriptForQuestionAndWallets(question, selectedWallets);
  }
};

// Main menu function
const mainMenu = async () => {
  const { menuOption } = await inquirer.prompt([
    {
      type: 'list',
      name: 'menuOption',
      message: 'Pilih opsi:',
      choices: ['Run Script', 'Tambah Wallet', 'Keluar']
    }
  ]);

  if (menuOption === 'Run Script') {
    const wallets = getWallets();
    if (wallets.length === 0) {
      console.log(chalk.red('✖ Tidak ada wallet yang tersedia. Silakan tambahkan wallet terlebih dahulu.'));
      await mainMenu();
      return;
    }

    const { selectedWallets } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedWallets',
        message: 'Pilih wallet untuk digunakan:',
        choices: wallets
      }
    ]);

    if (selectedWallets.length === 0) {
      console.log(chalk.yellow('⚠ Tidak ada wallet yang dipilih. Kembali ke menu utama...'));
      await mainMenu();
      return;
    }

    await runScriptForWallets(selectedWallets);
    await mainMenu();
  } else if (menuOption === 'Tambah Wallet') {
    await addWalletMenu();
    dotenv.config({ path: '.env' });
    await mainMenu();
  } else {
    console.log(chalk.red('✖ Operasi dibatalkan.'));
    process.exit(0);
  }
};

// Main function to execute the flow
const main = async () => {
  displayWelcomeMessage();
  await mainMenu();
};

// Run the main function
main();