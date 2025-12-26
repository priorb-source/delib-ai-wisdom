import fs from 'fs'
import path from 'path'

const QUESTIONS_PATH = 'data/processed/questions.json'
const INDEPENDENT_DIR = 'data/independent-forecasts'
const DELIBERATIVE_DIR = 'data/deliberative-forecasts'
const OUTPUT_DIR = 'data/analysis'

// Load all JSON files from a directory
const loadForecasts = (dir) => {
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    return files.map(f => {
        const content = fs.readFileSync(path.join(dir, f), 'utf8')
        return JSON.parse(content)
    })
}

// Convert array of objects to CSV (proper escaping)
const toCSV = (rows) => {
    if (rows.length === 0) return ''
    const headers = Object.keys(rows[0])
    const lines = [headers.join(',')]
    for (const row of rows) {
        const values = headers.map(h => {
            const v = row[h]
            if (v === null || v === undefined) return ''
            if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
                return `"${v.replace(/"/g, '""')}"`
            }
            return v
        })
        lines.push(values.join(','))
    }
    return lines.join('\n')
}

// Build clean dataset for R analysis
const buildDataset = () => {
    console.log('Loading data...')

    // Load questions
    const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
    console.log(`  Loaded ${questions.length} questions`)

    // Create question lookup
    const questionMap = {}
    for (const q of questions) {
        questionMap[q.id] = {
            id: q.id,
            title: q.questionTitle,
            resolution: q.resolution === 'yes' ? 1 : 0
        }
    }

    // Load forecasts
    const independentForecasts = loadForecasts(INDEPENDENT_DIR)
    const deliberativeForecasts = loadForecasts(DELIBERATIVE_DIR)
    console.log(`  Loaded ${independentForecasts.length} independent forecasts`)
    console.log(`  Loaded ${deliberativeForecasts.length} deliberative forecasts`)

    // Create independent forecast lookup
    const independentMap = {}
    for (const f of independentForecasts) {
        independentMap[f.forecastId] = f
    }

    // Build forecast rows (one row per forecast)
    const forecastRows = []

    // Add independent forecasts
    for (const f of independentForecasts) {
        const q = questionMap[f.questionId]
        if (!q) continue

        forecastRows.push({
            question_id: f.questionId,
            resolution: q.resolution,
            forecast_id: f.forecastId,
            stage: 'independent',
            condition: '',  // filled in when linked to deliberative
            model: f.model,
            info_label: f.infoLabel,
            position: '',
            probability: f.forecast.probability
        })
    }

    // Add deliberative forecasts
    for (const f of deliberativeForecasts) {
        const q = questionMap[f.questionId]
        if (!q) continue

        forecastRows.push({
            question_id: f.questionId,
            resolution: q.resolution,
            forecast_id: f.forecastId,
            stage: 'deliberative',
            condition: f.condition,
            model: f.model,
            info_label: f.infoLabel,
            position: f.position,
            probability: f.forecast.probability
        })
    }

    // Build condition-level rows (links independent to deliberative)
    const conditionRows = []

    // Group deliberative by question+condition
    const deliberativeByQC = {}
    for (const f of deliberativeForecasts) {
        const key = `${f.questionId}-${f.condition}`
        if (!deliberativeByQC[key]) deliberativeByQC[key] = []
        deliberativeByQC[key].push(f)
    }

    for (const [key, delGroup] of Object.entries(deliberativeByQC)) {
        const qid = delGroup[0].questionId
        const condition = delGroup[0].condition
        const q = questionMap[qid]
        if (!q) continue

        // Get linked independent forecasts
        const indIds = new Set()
        for (const df of delGroup) {
            indIds.add(df.independentForecastId)
            for (const id of df.otherForecastIds || []) indIds.add(id)
        }

        // Add one row per agent in this condition
        for (const df of delGroup) {
            const indF = independentMap[df.independentForecastId]
            if (!indF) continue

            conditionRows.push({
                question_id: qid,
                resolution: q.resolution,
                condition: condition,
                model: df.model,
                info_label: df.infoLabel,
                position: df.position,
                independent_forecast_id: df.independentForecastId,
                deliberative_forecast_id: df.forecastId,
                independent_prob: indF.forecast.probability,
                deliberative_prob: df.forecast.probability
            })
        }
    }

    // Build questions table
    const questionRows = Object.values(questionMap).map(q => ({
        question_id: q.id,
        resolution: q.resolution,
        title: q.title
    }))

    return { forecastRows, conditionRows, questionRows }
}

// Main
const main = () => {
    console.log('\n=== Building Analysis Dataset ===\n')

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    }

    const { forecastRows, conditionRows, questionRows } = buildDataset()

    console.log(`\nDataset summary:`)
    console.log(`  Forecasts: ${forecastRows.length}`)
    console.log(`  Condition pairs: ${conditionRows.length}`)
    console.log(`  Questions: ${questionRows.length}`)

    // Save CSVs
    fs.writeFileSync(path.join(OUTPUT_DIR, 'forecasts.csv'), toCSV(forecastRows))
    console.log(`\nSaved: data/analysis/forecasts.csv`)

    fs.writeFileSync(path.join(OUTPUT_DIR, 'condition_pairs.csv'), toCSV(conditionRows))
    console.log(`Saved: data/analysis/condition_pairs.csv`)

    fs.writeFileSync(path.join(OUTPUT_DIR, 'questions.csv'), toCSV(questionRows))
    console.log(`Saved: data/analysis/questions.csv`)

    console.log('\n=== Done (run Jupyter notebook next) ===\n')
}

main()
