# The Wisdom of Deliberating AI Crowds

This repository contains the source code and data for:

Schneider P, Schramm A. The Wisdom of Deliberating AI Crowds: Does Deliberation Improve LLM-Based Forecasting? arXiv [Preprint]. 2025. Available from: https://arxiv.org/abs/2512.22625

## tl;dr

Deliberation significantly improves forecasting accuracy for diverse teams of frontier models (GPT-5, Claude Sonnet 4.5, Gemini Pro 2.5), reducing Log Loss by 0.020 (p = 0.017, ~4% relative improvement). However, deliberation among homogeneous groups (three instances of the same model) yields no benefit. Unexpectedly, providing LLMs with additional contextual information did not improve forecast accuracy.


## Repository Structure

```
./
├── manuscript/
│   ├── manuscript.tex          # LaTeX source
│   ├── manuscript.pdf          # Compiled PDF
│   └── references.bib          # Bibliography
├── analysis/
│   ├── analysis.ipynb          # Main analysis notebook
│   └── mde.ipynb               # Minimum detectable effect calculations
├── data/
│   ├── raw/                    # Scraped Metaculus tournament data
│   │   └── questions.json
│   ├── processed/              # Questions with extracted information packages
│   │   └── questions.json
│   ├── independent-forecasts/  # 3,636 independent forecast files
│   │   └── {qid}-{model}-{info}.json
│   ├── deliberative-forecasts/ # 3,636 deliberative forecast files
│   │   └── {qid}-{condition}-{model}-{position}.json
│   └── analysis/               # Final CSVs for statistical analysis
│       ├── condition_pairs.csv
│       ├── forecasts.csv
│       ├── questions.csv
│       └── *.png               # Generated figures
├── src/
│   ├── agentUtils.js                   # OpenRouter model configuration
│   ├── metaculus-scraper.js            # Scrape tournament questions
│   ├── metaculus-helper.js             # Metaculus API utilities
│   ├── information-processor.js        # Extract 3 information units per question
│   ├── independent-forecasting-agent.js    # Single agent forecast logic
│   ├── independent-forecast.js             # Orchestrate independent forecasts
│   ├── deliberative-forecasting-agent.js   # Post-deliberation forecast logic
│   ├── deliberative-forecast.js            # Orchestrate deliberative forecasts
│   └── build-analysis-dataset.js           # Compile CSVs for analysis
├── package.json
├── pnpm-lock.yaml
└── requirements.txt            # Python dependencies for analysis
```

## Quick Start (Reproduce Analysis)

The complete dataset is included. You can reproduce all findings without scraping and running agents:

```bash
# Install Python dependencies
pip install -r requirements.txt

# Open the analysis notebook
jupyter notebook analysis/analysis.ipynb
```

## Full Replication (Run Agents)

**Note:** Running agents requires an OpenRouter API key and will incur costs (~$200-250).

### Prerequisites
- Node.js v20+
- Python 3.10+
- pnpm (or npm)

### Setup

```bash
# Install Node dependencies
pnpm install

# Create .env file
echo "OPENROUTER_API_KEY=your-key-here" > .env
```

### Data Pipeline

```bash
# 1. Scrape Metaculus tournament data
node src/metaculus-scraper.js

# 2. Extract information packages from comments
node src/information-processor.js

# 3. Generate independent forecasts (~2,400 API calls)
node src/independent-forecast.js

# 4. Generate deliberative forecasts (~3,600 API calls)
node src/deliberative-forecast.js

# 5. Build analysis CSVs
node src/build-analysis-dataset.js
```

## Models

| Model | OpenRouter ID |
|-------|---------------|
| GPT-5 (OpenAI) | `openai/gpt-5` |
| Claude Sonnet 4.5 (Anthropic) | `anthropic/claude-sonnet-4.5` |
| Gemini Pro 2.5 (Google) | `google/gemini-2.5-pro` |

## Experimental Design

- **Questions:** 202 resolved binary questions from Metaculus Q2 2025 AI Tournament
- **Conditions:** 4 experimental conditions (diverse_full, diverse_info, homo_full, homo_info); +2 (diverse_none, homo_none)
- **Metrics:** Log Loss (primary), Brier Score (robustness check)

### Key Conditions
- **diverse_full**: 3 different models (Pro, Sonnet, GPT-5), all with shared information
- **homo_full**: 3 instances of the same model, all with shared information
- **diverse_info**: 3 different models, each with 1/3 of the information
- **homo_info**: 3 instances of the same model, each with 1/3 of the information

## Data

This dataset includes questions from the [Metaculus Q2 2025 AI Tournament](https://www.metaculus.com/tournament/aibq2/). We thank Metaculus for making forecasting data publicly available. If there are any concerns about data usage, please open an issue.


## Citation

```bibtex
@article{schneider2025wisdom,
  title   = {The Wisdom of Deliberating AI Crowds: Does Deliberation Improve LLM-Based Forecasting?},
  author  = {Schneider, Paul and Schramm, Amalie},
  year    = {2025},
  note    = {Working paper}
}
```

## Funding Statement

This research was supported by the [Foresight Institute](https://foresight.org/).

## License

MIT License
