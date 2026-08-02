# simfork

用 Bun 打造的本地 EVM fork 模擬器 CLI，零依賴、獨立運作，裝好之後在任何目錄輸入 `sim` 即可。

底層仍用 [foundry anvil](https://book.getfoundry.sh/anvil/) 起鏈，但 fund / balance / snapshot / time travel 全部原生 TypeScript（viem）實作，不需要 `cast`、`forge`、`yq`。

本文所有範例都用這個錢包地址：

```
0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
```

（此地址在 `~/.simfork/config.yml` 的 `genesisAccounts` 裡，每次 `sim start` 會自動拿到 1000 ETH。）

## 目錄

- [安裝與初始化](#安裝與初始化)
- [起鏈 sim start](#起鏈-sim-start)
- [生命週期 stop / status / logs](#生命週期-stop--status--logs)
- [打幣 sim fund](#打幣-sim-fund)
- [查餘額 sim balance](#查餘額-sim-balance)
- [發交易 sim send](#發交易-sim-send)
- [唯讀呼叫 sim call](#唯讀呼叫-sim-call)
- [快照 snapshot / revert](#快照-snapshot--revert)
- [時間旅行 time / mine](#時間旅行-time--mine)
- [原始 JSON-RPC sim rpc](#原始-json-rpc-sim-rpc)
- [Token 別名 sim tokens](#token-別名-sim-tokens)
- [鏈設定 sim chains](#鏈設定-sim-chains)
- [上游 RPC 與 FORK_BLOCK](#上游-rpc-與-fork_block)
- [多實例操作](#多實例操作)
- [設定檔詳解](#設定檔詳解)
- [ERC20 funding 原理](#erc20-funding-原理)
- [疑難排解](#疑難排解)
- [速查表](#速查表)
- [開發](#開發)

## 安裝與初始化

```bash
cd simfork
bun install
bun link          # 註冊全域 `sim` 指令
sim init          # 產生 ~/.simfork/config.yml
```

前置需求：[bun](https://bun.sh)、[foundry](https://getfoundry.sh)（只用到 anvil）。

`sim init` 只做一件事：產生設定檔骨架（defaultChain 42161、defaultPort 8545、genesis 帳戶清單）。

接著設一條鏈的上游 RPC，就能開始用：

```bash
sim chains add arb https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY -b 483630160
sim start arb
sim -p 8545 fund usdt 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 5000
```

或連設定都不寫，一行帶上游：

```bash
sim start eth --fork-url https://ethereum-rpc.publicnode.com
```

手上已經有一份 dotenv 檔（含 `NETWORK_<chainId>_RPC_URL` / `NETWORK_<chainId>_FORK_BLOCK` 格式）的話，可以直接匯入：

```bash
sim init --from /path/to/.env.local
```

## 起鏈 sim start

### 基本

```bash
sim start arb        # fork Arbitrum One (42161)
sim start base       # fork Base (8453)
sim start 1          # 用 chain id 也可以
sim start            # 不帶參數 → config 的 defaultChain（預設 42161）
```

鏈名別名對照：

| 輸入 | Chain ID |
|---|---|
| `eth` / `mainnet` / `ethereum` | 1 |
| `op` / `optimism` | 10 |
| `bsc` / `bnb` | 56 |
| `polygon` / `matic` | 137 |
| `base` | 8453 |
| `arb` / `arbitrum` | 42161 |

成功輸出長這樣：

```
ℹ Starting anvil fork of arbitrum (42161) on port 8545 @ block 483630160
ℹ Funded 4 genesis account(s) with 1000 ETH
✔ Fork ready: http://localhost:8545 — chain 42161 (arbitrum), block 483630160, pid 94007
```

起鏈時自動完成（對應舊版 `fork_tenderly.sh` 全部行為）：

- `anvil_setChainId` → 本地鏈 ID 跟真鏈一致（錢包 App 不用改設定）
- `anvil_autoImpersonateAccount(true)` → 任何地址都能直接發交易，不用私鑰
- genesis 帳戶各打 1000 ETH（含範例地址 `0x56A0…8369`）
- port 自動挑選：預設埠被別條鏈的 fork 佔住時，自動往上找（8545 → 8546 → …）；同一條鏈重複 start 則原埠重啟。帶 `-p` 指定埠時不挑選，直接清掉佔用者

### 選項

```bash
sim start arb -b 483630160     # pin 在指定 block（anvil 可重用磁碟快取，重啟秒開）
sim start arb -p 8547          # 換 port
sim start arb -f               # 前景模式：串流 log，Ctrl-C 直接停鏈
sim start arb -t               # 開 --steps-tracing（opcode 級 trace，很吃 RPC）
sim start arb --fork-url https://arb-mainnet.g.alchemy.com/v2/KEY   # 臨時換上游 RPC
sim start arb -- --block-time 2 --gas-limit 30000000                # `--` 之後直通 anvil
```

沒帶 `-b` 時的 fork block 決定順序：config `chains.42161.forkBlock` → 環境變數 `NETWORK_42161_FORK_BLOCK` → 不 pin（會警告：每次重啟都要全量重抓 state）。

## 生命週期 stop / status / logs

```bash
sim status           # 列出所有 fork
# ● running  :8545  arbitrum (42161)  block 483630160  forked@483630160  via virtual.arbitrum.eu.rpc.tenderly.co  pid 94007 up since 2026-07-21T13:01:29Z

sim stop             # 只有一條 fork 在跑 → 直接停它
sim stop 8547        # 指定 port
sim stop --all       # 全停

sim logs             # 最後 50 行 anvil log
sim logs -n 200      # 最後 200 行
sim logs -f          # tail -f 持續追蹤
sim logs 8547 -f     # 指定 port
```

## 打幣 sim fund

統一語法：`sim -p 8545 fund <token> <receiver> <amount>`

### 打原生幣（ETH / BNB / MATIC）

```bash
sim -p 8545 fund eth 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 100
# ✔ 0x56A0…8369 native balance: 1000 → 1100
```

`eth`、`native`、`bnb`、`matic`、`pol` 都當原生幣處理。

### 打 ERC20 — 用別名

```bash
sim -p 8545 fund usdt 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 5000
# ✔ 0x56A0…8369 USD₮0: 0 → 5000

sim -p 8545 fund usdc 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 12345.67
# ✔ 0x56A0…8369 USDC: 2000 → 14345.67
```

### 打 ERC20 — 用地址

```bash
sim -p 8545 fund 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 5000
```

### 金額格式

| 寫法 | 意義 |
|---|---|
| `100` | 100 顆（自動抓 token decimals 換算）|
| `1.5` | 1.5 顆 |
| `10k` / `2m` / `1b` | 一萬 / 兩百萬 / 十億顆 |
| `--raw 99999999999999999999` | 直接寫 base units（等同舊版 `-a` 的行為）|
| `0xde0b6b3a7640000` | hex 也當 base units |

### 進階選項

```bash
# 預設是「加上去」；--set 改成「設成這個值」
sim -p 8545 fund usdt 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 5000 --set

# rebasing / share 型 token（stETH、aToken）找不到 balance slot 時，
# 改用鯨魚帳戶 impersonate 轉帳（自動先幫鯨魚補 gas ETH）
sim -p 8545 fund 0xTokenAddr 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 100 --whale 0x489ee077994B6658eAfA855C308275EAd8097C4A
```

## 查餘額 sim balance

```bash
# 掃描模式：原生幣 + 該鏈所有已知別名（只顯示非零）
sim -p 8545 balance 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
# native  1100
# USDC    14345.67  0xaf88d065e77c8cC2239327C5EDb3A432268e5831
# USD₮0   5000      0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9

# 指定 token（零餘額也會顯示）
sim -p 8545 balance 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 usdt weth
sim -p 8545 balance 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
```

## 發交易 sim send

語法：`sim -p 8545 send <合約> <函式簽名> [參數…] --from <地址>`

fork 開著 auto-impersonate，**任何 `--from` 都能發交易，不需要私鑰**。gas 不夠會自動補 10 ETH。

```bash
# ERC20 approve
sim -p 8545 send 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 \
  "approve(address,uint256)" \
  0xe592427a0aece92de3edee1f18e0157c05861564 1000000000 \
  --from 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
# ✔ tx 0x88cb… — gas used 44017

# ERC20 transfer（1000 USDT，注意這裡參數是 base units：6 decimals）
sim -p 8545 send 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 \
  "transfer(address,uint256)" \
  0x5a6ae290a438fd1461043339134fb3abe842a08c 1000000000 \
  --from 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369

# 帶 ETH value 的呼叫
sim -p 8545 send 0xSomeContract "deposit()" --value 1.5 --from 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
```

參數型別自動轉換：`uint/int` → bigint、`bool` → `true`/`1`、陣列用 `[a,b,c]`。tuple 不支援 — 用 `sim rpc` 帶 raw calldata。

交易 revert 會直接報錯（exit code 1）並顯示 gas used。

## 唯讀呼叫 sim call

支援 cast 式「簽名帶回傳型別」：`fn(輸入型別)(回傳型別)`

```bash
sim -p 8545 call 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 \
  "balanceOf(address)(uint256)" \
  0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
# 14345670000

sim -p 8545 call 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 "decimals()(uint8)"
# 6

sim -p 8545 call 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 "symbol()(string)"
# USDC

# 不寫回傳型別 → 印 raw hex
sim -p 8545 call 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 "balanceOf(address)" 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
```

## 快照 snapshot / revert

測試前存檔、玩壞了讀檔：

```bash
sim -p 8545 snapshot -m before-swap      # 具名快照
# ✔ Snapshot before-swap = 0x0

sim -p 8545 snapshot                     # 匿名快照（只回 id）
# ✔ Snapshot 0x1

# …做一堆破壞性操作…
sim -p 8545 fund usdt 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 999999
sim -p 8545 time +30d

sim -p 8545 revert before-swap           # 用名字回滾
sim -p 8545 revert 0x1                   # 用 id 也行
```

**重要**：anvil 快照是一次性的 — revert 之後該快照（與其後所有快照）失效。要再回同一點就要重拍。

## 時間旅行 time / mine

```bash
sim -p 8545 time +1d           # 快轉一天（自動挖一塊讓時間生效）
sim -p 8545 time +2h           # 支援 s / m / h / d / w
sim -p 8545 time +30m
sim -p 8545 time 1736650000    # 指定下一塊的 unix timestamp
# ✔ Next block mined at timestamp 1736650000 (2025-01-12T02:46:40.000Z)

sim -p 8545 mine               # 挖 1 塊
sim -p 8545 mine 10            # 挖 10 塊
sim -p 8545 mine 100 -i 12     # 挖 100 塊，每塊間隔 12 秒（模擬主網節奏）
```

典型用途 — 測「時間到了才能執行」的合約邏輯（vesting、cooldown、定期扣款）：

```bash
sim -p 8545 snapshot -m before                                          # 先存檔
sim -p 8545 time +1w                                                    # 快轉一週讓鎖倉到期
sim -p 8545 send 0xVault "claim()" --from 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
sim -p 8545 revert before                                               # 測完回滾，重來一次
```

## 原始 JSON-RPC sim rpc

逃生口 — 任何 anvil/hardhat 方法都能打：

```bash
sim -p 8545 rpc eth_blockNumber
# 0x1cd39c51

sim -p 8545 rpc anvil_setBalance 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 0x3635C9ADC5DEA00000
sim -p 8545 rpc anvil_impersonateAccount 0x489ee077994B6658eAfA855C308275EAd8097C4A
sim -p 8545 rpc evm_setAutomine false
sim -p 8545 rpc anvil_setCode 0xSomeAddr 0x6080…      # 直接換合約 bytecode
sim -p 8545 rpc anvil_setNonce 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 100
sim -p 8545 rpc anvil_reset '{"forking":{"jsonRpcUrl":"https://…","blockNumber":483630160}}'
```

參數會嘗試 JSON parse（物件、數字、布林），失敗就當純字串。

## Token 別名 sim tokens

```bash
sim tokens                # 目前連線鏈的別名清單
sim tokens -c 42161       # 指定鏈（不用起 fork）
# Tokens on arbitrum (42161):
#   dai        0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1
#   usdc       0xaf88d065e77c8cC2239327C5EDb3A432268e5831
#   usdc.e     0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8
#   usdt       0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
#   wbtc       0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
#   weth       0x82aF49447D8a07e3bd95BD0d56f35241523fBab1

# 加自訂別名（寫進 config，蓋過內建）
sim tokens add arb 0x912CE59144191C1204E64559FE8253a0e49E6548 -c 42161
sim -p 8545 fund arb 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 500
```

內建：六條鏈（1/10/56/137/8453/42161）的 USDC、USDT、WETH、WBTC、DAI 等（`src/tokens.ts`）。僅供本地模擬便利用途，正式環境請自行驗證地址。

## 鏈設定 sim chains

```bash
sim chains list
# 或直接 sim chains（list 是預設）
# Known chains:
#   1       ethereum   aliases: eth, mainnet, ethereum   rpc ✔  pin@25400574
#   10      optimism   aliases: op, optimism             rpc —
#   56      bsc        aliases: bsc, bnb                 rpc ✔
#   137     polygon    aliases: polygon, matic           rpc —
#   8453    base       aliases: base                     rpc ✔
#   42161   arbitrum   aliases: arb, arbitrum            rpc ✔  pin@483630160
```

`rpc —` 表示還沒設上游 URL。用指令補（不用手改 YAML）：

```bash
sim chains add arb https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY -b 483630160
sim chains add 8453 https://mainnet.base.org        # 沒名字的鏈直接用 chain id
sim chains rm arb                                    # 移除
```

`-b` 是 pin block（強烈建議設，anvil 才能重用磁碟快取、重啟秒開）。也可以改用環境變數 `NETWORK_<id>_RPC_URL` / `NETWORK_<id>_FORK_BLOCK`。

## 上游 RPC 與 FORK_BLOCK

### FORK_BLOCK 一定要填嗎？

不用，沒填照樣能起鏈——anvil 會 fork 上游當下的最新塊。代價有兩個：

1. **起鏈慢、吃 RPC 額度**：anvil 的磁碟快取（`~/.foundry/cache/rpc/`）只在 pin 住 block 時生效。沒 pin，每次重啟都全量重抓 state。
2. **狀態不固定**：每次起鏈都 fork 到不同的鏈上狀態，昨天測過的情境今天可能重現不了。

隨手玩可以不填；要重複測同一個情境、或上游額度有限，就填。

### 用 Tenderly 當上游是不是就不用填？

一半對。Tenderly Virtual TestNet 本身就是一條「在某個 block 建立好的 fork」——沒開 State Sync 的話，它的狀態凍結在建立當下，不會跟著真鏈走。所以就算不 pin，每次 fork 到的狀態也一樣，**重現性**這個理由消失了。

但**快取**這個理由還在：anvil 只認 block number，不管上游動不動，沒 pin 就是不用磁碟快取。結論——用 Tenderly 可以不填，重現性靠上游凍結保證；填了額外賺到重啟秒開。

### Tenderly 和 Alchemy 免費 RPC 差在哪？

|  | Tenderly Virtual TestNet | Alchemy 免費方案 |
|---|---|---|
| 上游是什麼 | 一條 fork 出來的虛擬鏈，狀態凍結在建立時的 block | 真鏈節點，狀態隨主網一直動 |
| 重現性 | 天生固定，不 pin 也一樣 | 要 pin block 才固定 |
| 歷史 state | 只有建立 block 附近的狀態 | 有 archive 資料，pin 舊 block 也抓得到 state |
| 額度 | free plan 有用量限制，虛擬鏈也有存活期限 | 額度制（compute units），fork 起鏈那陣子消耗最兇 |
| 額外能力 | 自帶 dashboard、可在 Tenderly 上直接改虛擬鏈狀態 | 純 RPC |

實務上怎麼選：

- **測「當下」的主網狀態、常換 block 重測** → Alchemy（或任何 archive RPC）+ pin block。
- **團隊要共用同一份凍結狀態**（大家 fork 同一條虛擬鏈，看到的東西一致）→ Tenderly。
- 完全免費的公共 RPC（如 `publicnode`）也能用，但通常沒有 archive、限流也緊——pin 太舊的 block 會抓不到 state，臨時試用可以，日常開發不建議。

### FORK_BLOCK 怎麼拿？

值就是「你想凍結在哪一塊」，通常拿當下最新塊就好。三種方式：

```bash
# 1. 偷懶法：先不帶 -b 起一次鏈，輸出最後一行就有當下 block
sim start arb
# ✔ Fork ready: http://localhost:8545 — chain 42161 (arbitrum), block 483630160, pid 94007
#                                                                      ^^^^^^^^^ 就是這個
sim chains add arb https://your-rpc -b 483630160   # 之後就 pin 住了

# 2. 直接問上游 RPC（回傳是 hex，printf 轉十進位）
curl -s -X POST https://your-rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"0x1cd39c51"}
printf '%d\n' 0x1cd39c51
# 483630161
```

第三種：開區塊瀏覽器（arbiscan.io、basescan.org、etherscan.io）首頁抄最新 block。

注意：pin 的 block 不能比上游現有的新；pin 很舊的 block 需要上游有 archive 資料（見上表）。上游是 Tenderly 虛擬鏈時，就 pin 它建立時的 block（dashboard 上看得到）。

## 多實例操作

同時跑多條鏈，port 會自動排開，不用手動指定：

```bash
sim start arb                 # port 8545
sim start base                # 8545 被 arb 佔住 → 自動用 8546
sim start eth -p 18453        # 也可以手動指定
```

之後每個指令用**全域選項**指定目標：

```bash
sim -p 18453 fund usdc 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 1000
sim -u http://localhost:18453 balance 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
```

目標決定順序：`-u/--rpc` → `-p/--port`（localhost）→ **恰好一條 fork 在跑就自動選它** → 都沒有才試 localhost:8545。

**同時跑兩條以上、又沒帶 `-p` 時會直接報錯**，列出所有埠讓你挑，不會偷偷猜 8545：

```
✖ Multiple forks running: 8545 (arbitrum), 8546 (ethereum). Target one with -p <port>.
```

只跑一條 fork 時 `-p` 可以省略（自動連到它）。本文件的範例為了避免歧義，一律寫 `-p 8545`。

## 設定檔詳解

`~/.simfork/config.yml`：

```yaml
defaultChain: 42161        # sim start 不帶參數時 fork 這條
defaultPort: 8545
genesisEth: 1000           # 每個 genesis 帳戶拿多少 ETH
genesisAccounts:           # 每次 start 自動打 ETH 的地址
  - '0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369'
  - '0xc185774a25936b17049a98fbaf14d9f2d7432771'
  - '0x489ee077994B6658eAfA855C308275EAd8097C4A'
  - '0x5a6ae290a438fd1461043339134fb3abe842a08c'
chains:
  '42161':
    rpcUrl: https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
    forkBlock: 483630160   # pin → anvil 磁碟快取生效，重啟秒開
  '8453':
    rpcUrl: https://mainnet.base.org
tokens:                    # 自訂別名（蓋過內建）
  '42161':
    arb: '0x912CE59144191C1204E64559FE8253a0e49E6548'
```

`chains` 區塊平常用 `sim chains add` 維護即可，不必手改。優先序：config 檔 > 環境變數（`NETWORK_<id>_RPC_URL` / `NETWORK_<id>_FORK_BLOCK`）。

其他路徑：

| 路徑 | 內容 |
|---|---|
| `~/.simfork/run/<port>.json` | 運行中實例記錄（pid、chain、快照名對照）|
| `~/.simfork/logs/anvil-<port>.log` | anvil 輸出 |
| `~/.simfork/cache/slots.json` | ERC20 balance slot 快取 |

## ERC20 funding 原理

與舊版 `fund_erc20.sh` 相同思路，但不需 forge script：

1. 對候選 slot（Solidity `keccak(key,slot)` 與 Vyper `keccak(slot,key)` 兩種佈局、index 0–127）寫入哨兵值
2. 呼叫 `balanceOf` 驗證、隨即還原原值
3. 找到後快取在 `~/.simfork/cache/slots.json`（同一 token 第二次 fund 約 0.1 秒）
4. 寫入 `目前餘額 + 金額`，再讀回驗證

Proxy token（如 USDC）沒問題 — storage 本來就在 proxy 地址上。rebasing/share 型 token（stETH、aToken）偵測不到 slot 時，改用 `--whale` 路徑。

## 疑難排解

**`No RPC responding at http://localhost:8545`**
→ fork 沒起。`sim start arb`。多實例時記得 `-p` 指定。

**start 卡在等待、最後 timeout**
→ 上游 RPC 掛了或 key 失效。`sim logs` 看 anvil 錯誤。臨時換上游：`sim start arb --fork-url <url>`。

**`Could not locate the balance slot of 0x…`**
→ 該 token 用非標準 balance 儲存（rebasing/share 型，如 stETH、aToken）。改走鯨魚路徑：
```bash
sim -p 8545 fund 0xToken 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 100 --whale <有大量該幣的地址>
```
鯨魚地址去區塊鏈瀏覽器的 token holders 頁找。

**每次 start 都很慢**
→ 沒 pin block。設 `chains.<id>.forkBlock`（或 `-b`），anvil 會重用 `~/.foundry/cache/rpc/` 磁碟快取。

**`Snapshot xxx not found or already consumed`**
→ anvil 快照一次性。revert 過就要重拍。

**交易 revert 想看原因**
→ `sim logs` 找該 tx；要 opcode 級 trace 用 `sim start arb -t` 重起，或 `sim rpc debug_traceTransaction 0xTxHash`。

**port 被佔**
→ 不帶 `-p` 時 `sim start` 自動跳到下一個空埠，不會殺別條鏈。想搶回特定埠就帶 `-p <port>`（會清掉佔用者），或手動 `sim stop <port>` / `lsof -ti tcp:8545 | xargs kill`。

## 速查表

```bash
sim init                                          # 首次設定
sim chains add arb https://your-rpc -b 483630160  # 設上游 RPC
sim start arb                                     # fork Arbitrum
sim -p 8545 fund eth  0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 100
sim -p 8545 fund usdt 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369 5000
sim -p 8545 balance   0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
sim -p 8545 send  0xToken "approve(address,uint256)" 0xSpender 1000000 --from 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
sim -p 8545 call  0xToken "balanceOf(address)(uint256)" 0x56A0CecD5238fb47b1CE977Ae48e6A8d22368369
sim -p 8545 snapshot -m save1 && sim -p 8545 time +1d && sim -p 8545 revert save1
sim stop
```

## 開發

```bash
bun run typecheck
bun test
```
