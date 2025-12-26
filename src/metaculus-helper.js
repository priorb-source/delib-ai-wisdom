// METACULUS API: https://www.metaculus.com/api/
// requests are throttled to 1000 requests per hour

const BASE_URL = 'https://www.metaculus.com/api/';
// const TOURNAMENT_ID = 'aibq2' // aibq2 AI forecasting bot tournament Q2 2025

export async function getPostsByTournamentId(tournamentId) {
    const POSTS_URL = BASE_URL + 'posts/';
    const MAX_POSTS = 1_000;
    const LIMIT = 100;
    let offset = 0;
    let hasNext = true;
    let errorCount = 0;
    let posts = [];

    while (offset < MAX_POSTS && hasNext && errorCount < 3) {
        process.stdout.write(`\rFetching posts ${offset} to ${offset + LIMIT}...`);
        const QUERY_PARAMS = `?tournaments=${tournamentId}&statuses=resolved&forecast_type=binary&limit=${LIMIT}&offset=${offset}&order_by=-published_at`;
        const URL = POSTS_URL + QUERY_PARAMS;
        const response = await fetch(URL);
        if (!response.ok) {
            if (response.status === 429) {
                errorCount++;
                console.error('Rate limit exceeded, waiting 5 second...');
                await new Promise(resolve => setTimeout(resolve, 5_000));
                continue; // retry the request
            } else {
                console.error(`HTTP error! status: ${response.status}`);
                console.error('Response text:', await response.text());
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        const data = await response.json();
        posts.push(...data.results);
        offset += LIMIT;
        hasNext = data.next !== null && data.results && data.results.length === LIMIT;
        if (hasNext) await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    return posts;
}
// getPostsByTournamentId(TOURNAMENT_ID).then(posts => console.log(posts));

export async function getCommentsByAuthorId(authorId, postId = undefined, filterPostIds = []) {

    if (filterPostIds && filterPostIds.length > 0 && postId && !filterPostIds.includes(postId)) {
        throw new Error(`If you use postId, it must be in filterPostIds`);
    }
    const COMMENTS_URL = BASE_URL + 'comments/';
    const MAX_COMMENTS = 10_000;
    const LIMIT = 100;
    let offset = 0;
    let hasNext = true;
    let allResults = [];

    while (offset < MAX_COMMENTS && hasNext) {
        process.stdout.write(`\rFetching comments ${offset} to ${offset + LIMIT}...`);
        const URL = COMMENTS_URL + `?author=${authorId}` + (postId ? `&post=${postId}` : '') + `&use_root_comments_pagination=true&limit=${LIMIT}&offset=${offset}`;
        const response = await fetch(URL);
        if (!response.ok) {
            if (response.status === 429) {
                errorCount++;
                console.error('Rate limit exceeded, waiting 5 second...');
                await new Promise(resolve => setTimeout(resolve, 5_000));
                continue; // retry the request
            } else {
                console.error(`HTTP error! status: ${response.status}`);
                console.error('Response text:', await response.text());
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        const data = await response.json();
        if (offset === 0) {
            console.log("total comments:", data.total_count);
        }
        const results = data.results;
        if (results && results.length > 0) {
            allResults.push(...results);
        }
        hasNext = data.next !== null && results && results.length >= LIMIT;
        offset += LIMIT;
        if (hasNext) await new Promise(resolve => setTimeout(resolve, 2_000));
    }


    allResults = allResults.filter(result => result.text !== null && result.text !== '' && result.text.length > 0 && result.included_forecast && result.included_forecast.start_time);

    if (filterPostIds.length > 0) {
        let filteredResults = [];
        filterPostIds.forEach(postId => {
            let _comments = allResults.filter(result => result.on_post === postId || result.on_post_data?.id === postId);
            let _out = {
                postId: postId,
                authorId: authorId,
                text: _comments.map(result => result.text).join('\n'),
            }
            filteredResults.push(_out);
        });
        return filteredResults;
    }

    const uniqueIds = [...new Set(allResults.map(result => result.on_post || result.on_post_data?.id))];
    let filteredResults = [];
    uniqueIds.forEach(postId => {
        let _comments = allResults.filter(result => result.on_post === postId || result.on_post_data?.id === postId);
        let _out = {
            postId: postId,
            authorId: authorId,
            text: _comments.map(result => result.text).join('\n'),
        }
        filteredResults.push(_out);
    });
    return filteredResults;
}
// sample POST id: 38543
// getCommentsByAuthorId(191026, 38543).then(comments => console.log(comments));




