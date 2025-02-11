import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";
import chalk from "chalk";
import inquirer from "inquirer";

dotenv.config();

const JSON_FILE = "payloads.json";
const API_MAIN = "https://deployment-hlsy5tjcguvea2aqgplixjjg.stag-vxzy.zettablock.com/main";
const API_REPORT = "https://quests-usage-dev.prod.zettablock.com/api/report_usage";
const API_INFERENCE = "https://neo-dev.prod.zettablock.com/v1/inference?id=";

console.log(chalk.cyan.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
console.log(chalk.magenta.bold("🚀 SCRIPT SEDANG BERJALAN... 🚀"));
console.log(chalk.cyan.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

dotenv.config({ path: ".env" });

async function mainMenu() {
  const { menuOption } = await inquirer.prompt([
    {
      type: "list",
      name: "menuOption",
      message: "Pilih opsi:",
      choices: ["Run Script", "Tambah Wallet", "Keluar"],
    },
  ]);

  if (menuOption === "Run Script") {
    await runScript();
  } else if (menuOption === "Tambah Wallet") {
    await addWalletMenu();
    dotenv.config({ path: ".env" });
    await mainMenu();
  } else {
    console.log(chalk.red("✖ Operasi dibatalkan."));
    process.exit(0);
  }
}

function getWallets() {
  dotenv.config({ path: ".env" });
  return Object.keys(process.env)
    .filter((key) => key.startsWith("WALLET_ADDRESS_"))
    .map((key) => process.env[key]);
}

async function addWalletMenu() {
  while (true) {
    const { walletAddress } = await inquirer.prompt([
      {
        type: "input",
        name: "walletAddress",
        message: "Masukkan alamat wallet baru (kosong untuk kembali):",
      },
    ]);

    if (!walletAddress.trim()) {
      console.log(chalk.yellow("⚠ Kembali ke menu utama..."));
      return;
    }

    const newKey = `WALLET_ADDRESS_${getWallets().length + 1}`;
    fs.appendFileSync(".env", `\n${newKey}=${walletAddress}`);
    dotenv.config({ path: ".env" });
    console.log(chalk.green("✅ Wallet berhasil ditambahkan!"));
  }
}

async function runScript() {
  while (true) {
    const wallets = getWallets();
    if (wallets.length === 0) {
      console.log(chalk.red("⚠ Tidak ada wallet yang tersedia. Tambahkan wallet terlebih dahulu."));
      await addWalletMenu();
      continue;
    }

    const { selectedWallets } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "selectedWallets",
        message: "Pilih wallet untuk digunakan:",
        choices: wallets,
      },
    ]);

    if (selectedWallets.length === 0) {
      console.log(chalk.red("⚠ Tidak ada wallet yang dipilih. Kembali ke menu utama..."));
      return await mainMenu();
    }

    const payloads = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    const results = {};

    for (const message of payloads) {
      console.log(chalk.blue(`[Question] ${message}`));
      results[message] = [];

      await Promise.all(selectedWallets.map(async (wallet) => {
        const result = await sendRequest(wallet, message);
        if (result) results[message].push(result);
      }));

      results[message].forEach((res) => {
        console.log(chalk.green(`✔ ${res.wallet} - ${res.status} - ${res.txHash}`));
      });
      console.log("");
    }

    console.log(chalk.green.bold("✅ Semua proses selesai!"));

    const { returnToMenu } = await inquirer.prompt([
      {
        type: "confirm",
        name: "returnToMenu",
        message: "Kembali ke menu utama?",
        default: true,
      },
    ]);

    if (returnToMenu) {
      await mainMenu();
    } else {
      process.exit(0);
    }
  }
}

async function sendRequest(walletAddress, message) {
  try {
    const response = await axios.post(
      API_MAIN,
      { wallet_address: walletAddress, message, stream: true },
      { headers: { "Content-Type": "application/json" } }
    );
    const collectedData = response.data;

    const reportResponse = await axios.post(
      API_REPORT,
      {
        wallet_address: walletAddress,
        agent_id: "deployment_HlsY5TJcguvEA2aqgPliXJjg",
        request_text: message,
        response_text: collectedData,
        request_metadata: { source: "api_test" },
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const interactionId = reportResponse.data.interaction_id;
    if (!interactionId) throw new Error("interaction_id not found");

    let status = "pending", txHash = "";
    let retries = 0, maxRetries = 10;

    while ((status === "pending" || !txHash) && retries < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000));
      const inferenceResponse = await axios.get(`${API_INFERENCE}${interactionId}`);
      status = inferenceResponse.data.data.status;
      txHash = inferenceResponse.data.data.tx_hash;
      retries++;
    }

    if (status === "pending" || !txHash) {
      console.log(chalk.yellow(`⚠ ${walletAddress} - Timeout, lanjut ke pertanyaan berikutnya.`));
      return null;
    }

    return { wallet: walletAddress, status, txHash };
  } catch (error) {
    console.log(chalk.red("Error:"), error.message);
    return null;
  }
}

mainMenu();
