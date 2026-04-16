<div align="center">
  <a href="../"><b>⬅️ Back to Main M2Tracker Repository</b></a>
  <br><br>
  <a href="https://m2tracker.pages.dev/" target="_blank">
    <img src="https://img.shields.io/badge/🚀_LAUNCH_LIVE_DEMO-m2tracker.pages.dev-4f46e5?style=for-the-badge" alt="Launch Live Demo" />
  </a>
</div>

<br>

# 🚀 Metin2 Market Analytics Engine
A system built from scratch for automated collection, processing, and analysis of market data directly from the Metin2 game client. This is not a classic web scraper. It is a fully automated data pipeline based on controlled process memory read/write operations, designed to build a reliable market intelligence source for the virtual economy.

## 📌 Table of Contents
- [💡 Core Idea](#-core-idea)
- [🏗️ Architecture and Pipeline Operation](#️-architecture-and-pipeline-operation)
- [🛡️ Reliability and Key System Features](#️-reliability-and-key-system-features)
- [🔄 Data Flow](#-data-flow)
- [🧭 Where to Start Reading the Code?](#-where-to-start-reading-the-code)
- [📂 Directory Structure](#-directory-structure)
- [📌 Roadmap / Planned Documentation Additions](#-roadmap--planned-documentation-additions)
- [⚠️ Security Notice and Legal Disclaimer](#️-security-notice-and-legal-disclaimer)

## 💡 Core Idea
The main goal of this project is to extract raw market data from the game world and transform it into structured analytical datasets ready for BI (Business Intelligence) systems and interactive dashboards.

**In practice, this pipeline enables:**
* Real-time item price tracking.
* Observation of trends and supply changes on a server.
* Comparison of market segments (for example, simple upgrade items vs. unique gear with bonuses).
* Detection of price anomalies and potential market opportunities.

The pipeline extracts key metadata from in-game shops: item names, prices, offer volume, stats/bonuses, and frequency of item occurrences on the server.

---

## 🏗️ Architecture and Pipeline Operation

The project is split into specialized modules, each responsible for a specific stage of the data flow.

### 🕵️‍♂️ 1. Shop Data Extraction (Memory Reading)
**Main files:** `market_pipeline_manager.py`, `shop_data_scraper.py`, `shop_scanner.py`

This layer is responsible for raw data capture from the game client using memory read/write techniques. The main entry point and orchestrator is `market_pipeline_manager.py`.

**Execution algorithm:**
1. Start the client or attach to an already running game process.
2. Perform automated login and enter a dedicated scanning character.
3. Teleport the character across predefined map points and detect nearby shop entities.
4. **Distance bypass:** The shop is "teleported" in memory directly to the player, bypassing interaction distance limits without manual movement.
5. Open the shop and read data directly from memory, slot by slot.
6. Close the shop, restore original coordinates, and move to the next object.
7. Save the session and dump raw data (for example to `shop_data_scrapper_*.json`).

⏱️ **Performance:** Due to server-imposed interaction cooldowns, one full scanning iteration for a map point usually takes about **1 minute**.

---

### 🧠 2. Innovative Metadata Recovery System (Item Link Injection)
**Main files:** `item_link_scanner.py`, `item_slot_coverage_scanner.py`

Raw shop scans mostly return item IDs. Item names and inventory size are not reliably available directly from shop entities, and static reverse engineering of client files is expensive and becomes obsolete after every server update. This is solved by an original use of the **in-game item link mechanism in chat**.

#### `item_link_scanner.py` (ID -> Name Mapping)
1. **Dynamic chat location:** The system writes a test string, scans memory, and stores a pointer. This process is repeated (about 13 iterations) to choose a stable address and minimize sudden pointer invalidation.
2. Replace the item ID in the first inventory slot and refresh the UI (simulated `Alt` key press).
3. Force sending the item link to chat. The **game itself renders the current item name and metadata** from its internal resources.
4. Read chat text from memory and store the `ID -> Name` mapping.
5. Clear chat and repeat for subsequent IDs.
*Performance: around 1000 items in about 50 seconds.*

#### `item_slot_coverage_scanner.py` (ID -> Slot Count Mapping)
It uses a similar mechanism, but the goal is to detect the physical inventory size of an item. The script attempts to generate the item in lower slots. If a link appears only after moving, for example, two slots down, the item occupies 3 slots. The result is an `ID -> SlotCount` map required by ETL for proper categorization.

---

### 📊 3. Data Transformation (ETL Process)
**Main file:** `market_data_transform.py`

The final stage transforms raw memory dumps (Raw Data) into a structured format ready for dashboards and historical analytics.

**ETL layer operations:**
* **Dictionary mapping:** Mapping raw identifiers and memory offsets to readable item and bonus names.
* **Aggregation:** Merging identical offers from multiple shops across the server.
* **Market statistics calculation:** For each group, key metrics are computed: `min`, `max`, `q10`, `q20`, `median`, and `total volume (amount)`.
* **Algorithmic categorization:** Splitting items into groups such as `simple_items` (upgraders, passes), `bonus_items` (unique gear with attributes), and `unknown_items`.
* **Global metrics:** Aggregating high-level market information (for example, total scanned shops and median unique items per shop).

---

## 🔄 Data Flow

```
[Metin2 game process]
       |
       |  ReadProcessMemory / WriteProcessMemory
       v
[memory/ - HAL]
       |
       |--> EntityList.get_filtered_entities()  -> shop entity list
       |--> Player.send_talk_to_vid()           -> open shop
       |--> Shop.get_item_info_for_slot_id()    -> VID, price, bonuses
       '--> InventorySlots.set_item_vid_to_slot() + ItemLinkScanner -> names
       |
       v
[ShopDataScraper - raw data]
  sessions/<server>_session.json  (checkpoint)
       |
       v
[servers/<server>/shop_data_scrapper_data/
  shop_data_scrapper_YYYY-MM-DD_HH-MM.json]
       |
       v
[market_data_transform.py]
  merge_shop_items() -> prepare_items_data()
       |
       v
[prepared_data_YYYY-MM-DD.json]
  -> simple_items, bonus_items, unknown_items
       |
       v
[M2Tracker Backend API]
```

---

## 🛡️ Reliability and Key System Features

* **Resilient chat scanning:** Retry mechanisms and repeated address discovery when references are lost by the game engine.
* **Runtime error control:** Detailed incident logging, counting flags such as `failed_to_open`, and tracking missing item-name cases.
* **Session Resume:** Full support for session recovery (`sessions/*_session.json`), allowing scan continuation after unexpected interruption.
* **Server modularity:** Architecture based on runner classes and per-server configuration in `servers/`, enabling parallel scaling across multiple game servers.

---

## 🧭 Where to Start Reading the Code?

To navigate the architecture efficiently, the recommended reading order is:
1. `market_pipeline_manager.py` - full application orchestration.
2. `shop_data_scraper.py` and `shop_scanner.py` - raw extraction layer and memory integration.
3. `item_link_scanner.py` and `item_slot_coverage_scanner.py` - innovative metadata recovery.
4. `market_data_transform.py` - final analytical transformation (ETL).

---

## 📂 Directory Structure
```text
market_data_pipeline/
├── market_pipeline_manager.py      # Main entry point - orchestrator
├── shop_data_scraper.py            # Login, teleportation, session management
├── shop_scanner.py                 # Shop scanner abstraction (ABC)
├── item_link_scanner.py            # Name detection through chat item links
├── item_slot_coverage_scanner.py   # Detecting item size (1/2/3 slots)
├── market_data_transform.py        # Aggregation, statistics, categorization
│
├── memory/                         # Memory abstraction layer
│   ├── base_pointers.py            # Pointer initialization via signatures
│   ├── game_modules.py
│   ├── game_modules_mixin.py
│   ├── observer.py
│   ├── utilities.py
│   └── pointers/
│       ├── player.py               # Position, movement, player VID
│       ├── entity_list.py          # Entity list (NPCs, shops) with filtering
│       ├── shop.py                 # Open shop slot and price reading
│       ├── dinput.py               # DirectInput-based key emulation
│       ├── window_messages.py      # Clicking, typing, Win32 messages
│       ├── inventory_slots.py      # Inventory slot VID modification
│       ├── dropped_items.py
│       └── skills.py
│
└── servers/
    └── <server_name>/
        ├── variables.py            # Server-specific memory signatures
        ├── shop_scanner_runner.py  # ServerShopScanner + ServerShop (entry point)
        ├── shop_data_scrapper_runner.py
        ├── item_link_scanner_runner.py
        ├── data_preparation.py     # Post-scrape data processing
        ├── item_names.json         # VID -> item name map
        └── item_recognition/
```

---

## 📌 Roadmap / Planned Documentation Additions
* **Short GIF file** demonstrating rapid item-link scanner operation inside the game window.
* **"Raw vs Prepared Data" comparison** showing raw JSON samples side by side with transformed output from the transformation module.
* **Dashboard mockup** presenting a realistic chart for market price and supply trends.
* **KPI section** documenting real runtime metrics (loop duration, opened/failed shops, unknown item rate).

---

## ⚠️ Security Notice and Legal Disclaimer

**Security notice:** This pipeline operates directly on game process memory. Using it on servers where you do not have proper authorization may violate server rules. The project is intended solely for personal use on private servers where you have administrative access or explicit permission.

This project **is not runnable out of the box**. The current pointer signatures included in the repository are outdated and are provided only for demonstration/educational purposes. The project is not intended to harm any server and does not support such behavior.
