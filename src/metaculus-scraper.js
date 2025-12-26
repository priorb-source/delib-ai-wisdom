import fs from 'fs';
import { getPostsByTournamentId, getCommentsByAuthorId } from './metaculus-helper.js';
fs.mkdirSync('data/raw', { recursive: true });

// SCRAPE AI FORECASTING BOT TOURNAMENT Q2 2025 - BINARY QUESTIONS ONLY
const TOURNAMENT_ID = 'aibq2'

// 1. get all posts in tournament
const posts = posts = await getPostsByTournamentId(TOURNAMENT_ID);


// 2. get comments from top 4 AI bots in tournament
const AUTHORS = [
    191026, // mantic AI
    191935, // pgodzinai
    188389, // Panshul42
    269787, // metac-o3-high+asknews
]
// ids of all posts in tournament (api doesn't support filtering by tournament)
const postIds = posts.map(post => post.id);


let allComments = [];
for (const authorId of AUTHORS) {

    let comments = [];
    if (fs.existsSync(`data/raw/comments_${authorId}.json`)) {
        comments = JSON.parse(fs.readFileSync(`data/raw/comments_${authorId}.json`, 'utf8'));
        console.log(`Loaded ${comments.length} comments for author ${authorId} from file.`);
    } else {
        comments = await getCommentsByAuthorId(authorId, undefined, postIds);
        console.log(`Fetched ${comments.length} comments for author ${authorId}.`);
        // write comments to file
        fs.writeFileSync(`data/raw/comments_${authorId}.json`, JSON.stringify(comments, null, 2));
    }
    allComments.push(...comments);
}


const questionsRaw = posts.map(post => {

    const commentsText = allComments.filter(comment => comment.postId === post.id).map(comment => comment.text).join('\n============\n');

    return {
        id: post.id,
        postTitle: post.title,
        questionTitle: post.question.title,
        questionDescription: post.question.description,
        questionFinePrint: post.question.fine_print,
        questionResolutionCriteria: post.question.resolution_criteria,
        comments: commentsText,
        resolution: post.question.resolution,
        date: post.published_at?.split('T')[0],
    }
}).filter(question => {
    return question.resolution === 'yes' || question.resolution === 'no' && question.comments.length > 0;
}).filter(question => {
    return question.comments.length > 0;
});

console.log(`Questions scraped: ${questionsRaw.length}`);
fs.writeFileSync('data/raw/questions.json', JSON.stringify(questionsRaw, null, 2));

