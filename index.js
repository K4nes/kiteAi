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
const mainApiUrl = 'https://deployment-htmtbvzpc0vboktahrrv1b7f.stag-vxzy.zettablock.com/main';

// TTFT API
const ttftApiUrl = 'https://quests-usage-dev.prod.zettablock.com/api/ttft';

// REPORT USAGE API
const reportUsageApiUrl = 'https://quests-usage-dev.prod.zettablock.com/api/report_usage';

// Cache for API responses
const cache = {};

// Function to calculate time difference in milliseconds
const calculateTimeDifference = (startTime, endTime) => {
  return endTime - startTime;
};

// Function to send request to MAIN API with retries and caching
const sendMainApiRequest = async (message, retries = 3) => {
  if (cache[message]) {
    return cache[message];
  }

  const startTime = Date.now();
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(mainApiUrl, { message, stream: true }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        responseType: 'stream'
      });

      let buffer = '';
      let responseData = '';

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete lines in the buffer

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;

          try {
            const jsonStr = line.replace('data: ', '').trim();
            if (jsonStr) {
              const jsonData = JSON.parse(jsonStr);
              if (jsonData.choices[0].delta.content) {
                responseData += jsonData.choices[0].delta.content;
              }
            }
          } catch (error) {
            console.error('Error parsing chunk:', error);
          }
        }
      });

      return new Promise((resolve) => {
        response.data.on('end', () => {
          const endTime = Date.now();
          const timeToFirstToken = calculateTimeDifference(startTime, endTime);
          cache[message] = { responseData, timeToFirstToken };
          resolve(cache[message]);
        });
      });
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) {
        return { responseData: '', timeToFirstToken: 0 };
      }
      // Wait for 2 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
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
    agent_id: "deployment_htmTBVZpC0vbOkTAHRrv1b7F",
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

  if (!firstResponse) {
    console.log(chalk.red('✖ No response received from MAIN API. Skipping this question.'));
    return;
  }

  // Display TTFT and REPORT USAGE responses once
  const ttftResponse = await sendTtftApiRequest(timeToFirstToken);
  console.log(chalk.green('TTFT API Response:'), ttftResponse);

  const reportUsageResponse = await sendReportUsageApiRequest(selectedWallets[0], question, firstResponse);
  console.log(chalk.blue('REPORT USAGE API Response:'), reportUsageResponse);

  // Display Response Content for each wallet
  for (const wallet of selectedWallets) {
    const { responseData } = await sendMainApiRequest(question);
    const truncatedResponse = responseData ? responseData.substring(0, 50) : 'No response';
    console.log(chalk.white(`Response Content for ${wallet}:`), truncatedResponse);
  }
};

// Function to run the script for multiple wallets
const runScriptForWallets = async (selectedWallets) => {
  console.log(chalk.cyan(`\nRunning script for Wallet Addresses: ${selectedWallets.join(', ')}`));

  // Process questions sequentially
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