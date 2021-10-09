const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

try {
  const apiKey = '09045f0c83d151e8d48ec9feb99e78ae';
  const token = core.getInput('trello-token');
  const boardIdentifier = core.getInput('board-identifier');
  const marker = core.getInput('marker');

  const regex = getMarkerRegex(marker);
  const markerLength = marker.length;

  const payload = github && github.context && github.context.payload;
  const distinctMatches = fromCommit(regex, payload, markerLength)
    .concat(fromPullRequest(regex, payload, markerLength))
    .concat(fromIssue(regex, payload, markerLength))
    .filter((v, i, s) => s.indexOf(v) === i); // dedupe

  if (distinctMatches.length == 0) {
    console.log('no tags found');
    return;
  }

  getBoard(boardIdentifier, apiKey, token).then((board) => {
    if (!board || !board.boardId) {
      throw new Error('board could not be resolved');
    }
    return Promise.all(distinctMatches
      .map(match => {
        return getCard(match.id, board, apiKey, token)
          .then(card => {
            if (card) {
              console.log(`attaching '${match.title}' (${match.url}) to card '${card.cardName}' (${card.cardNumber})`);
              attachUrl(card, match.url, match.title, apiKey, token);
            }
          });
      }));
    })
    .catch(err => {
      core.setFailed(err && err.message);
    });

} catch (error) {
  core.setFailed(error.message);
}

function getMarkerRegex(marker) {
  console.log(`marker set as '${marker}'`);
  if (/^[a-zA-Z]+-$/g.test(marker)) {
    marker = `\\b${marker}`; // must be own word
  }else if (/^[a-zA-Z]+$/g.test(marker)) {
    marker = `\\b${marker}`; // must be own word
  } else if (marker.length !== 1) {
    throw new Error(' special character marker must be a single character');
  } else if (/^[!@#$%^&*+=]$/g.test(marker)) {
    marker = `\\${marker}`;
  } else {
    throw new Error("marker must be an alpha string, an alpha string followed by '-', or one of !@#$%^&*+=");
  }

  const regex = new RegExp(`${marker}[0-9]+\\b`, 'g');
  return regex;
}

function fromCommit(regex, payload, markerLength) {
  if (!payload) {
    return [];
  }
  const commits = (payload && payload.commits && payload.commits.length || 0) > 0
    ? payload.commits
    : [payload.head_commit];

  return commits
    .filter(commit => !!(commit && commit.message))
    .map(commit => {
      console.log(`commit message: '${commit.message}'`);
      return handleMatches(commit.message.match(regex), markerLength, () => commit.url, () => commit.message);
    })
    .flat();
}

function fromPullRequest(regex, payload, markerLength) {
  if (!payload) {
    return [];
  }
  const pullRequest = payload.pull_request;
  if (!pullRequest) {
    return [];
  }
  console.log(`PR title: '${pullRequest.title}'`);
  const fromTitle = (pullRequest.title
    ? () => handleMatches(pullRequest.title.match(regex), markerLength, () => pullRequest.html_url, () => pullRequest.title)
    : () => [])();
  console.log(`PR body: '${pullRequest.body}'`);
  const fromBody = (pullRequest.body
    ? () => handleMatches(pullRequest.body.match(regex), markerLength, () => pullRequest.html_url, () => pullRequest.title)
    : () => [])();

  return fromTitle.concat(fromBody);
}

function fromIssue(regex, payload, markerLength) {
  if (!payload) {
    return [];
  }
  const issue = payload.issue;
  if (!issue) {
    return [];
  }
  console.log(`issue title: '${issue.title}'`);
  const fromTitle = (issue.title
    ? () => handleMatches(issue.title.match(regex), markerLength, () => issue.html_url, () => issue.title)
    : () => [])();
  console.log(`issue body: '${issue.body}'`);
  const fromBody = (issue.body
    ? () => handleMatches(issue.body.match(regex), () => issue.html_url, () => issue.title)
    : () => [])();

  return fromTitle.concat(fromBody);
}

function handleMatches(matches, markerLength, getUrlFn, getTitleFn) {
  if (matches) {
    return matches
      .filter((v, i, s) => s.indexOf(v) === i) // dedupe
      .map(match => {
        console.log(`found potential tag '${match}'`);
        return match.substring(markerLength);
      })
      .filter(v => v != null)
      .map(id => {
        return {
          id: id,
          url: getUrlFn(),
          title: getTitleFn(),
        };
      });
  }
  return [];
}

function getBoard(boardIdentifier, apiKey, token) {
  if (boardIdentifier) {
    return axios.get('https://api.trello.com/1/members/me/boards'
    + '?fields=id,name,shortLink'
    + `&key=${encodeURIComponent(apiKey)}`
    + `&token=${encodeURIComponent(token)}`)
    .then(resp => {
      const json = resp && resp.data;
      return json && json
        .filter(b => b.name === boardIdentifier || b.shortLink === boardIdentifier || b.id === boardIdentifier)
        .map(b => {
          return {boardId: b.id, boardName: b.name};
        })[0];
    });
  }
  return Promise.resolve(null);
}

function getCard(cardIdentifier, board, apiKey, token) {
  console.log(`searching trello board '${board.boardName}' for card '${cardIdentifier}'`);
  return axios.get(`https://api.trello.com/1/boards/${encodeURIComponent(board.boardId)}/cards/${encodeURIComponent(cardIdentifier)}`
    + `?key=${encodeURIComponent(apiKey)}`
    + `&token=${encodeURIComponent(token)}`)
  .then(resp => {
    const json = resp && resp.data;

    return { cardId: json.id, cardName: json.name, cardNumber: json.idShort };
  })
  .catch(err => {
    console.log(`Did not find card '${cardIdentifier}' on board '${board.boardName}'`, err);
  });
}

function attachUrl(cardDetails, url, title, apiKey, token) {
  return axios.post(`https://api.trello.com/1/cards/${encodeURIComponent(cardDetails.cardId)}/attachments`
      + `?name=${encodeURIComponent(title)}`
      + `&url=${encodeURIComponent(url)}`
      + `&key=${encodeURIComponent(apiKey)}`
      + `&token=${encodeURIComponent(token)}`)
    .then(() => {
      console.log(`attached '${title}' (${url}) to card '${cardDetails.cardName}' (${cardDetails.cardNumber})`);
    });
}
