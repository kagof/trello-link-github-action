const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

try {
  const apiKey = '09045f0c83d151e8d48ec9feb99e78ae';
  const token = core.getInput('trello-token');
  const boardIdentifier = core.getInput('board-identifier');
  const allowMissingBoard = core.getBooleanInput('allow-missing-board');

  const regex = getMarkerRegex();

  const payload = github && github.context && github.context.payload;
  const distinctMatches = fromCommit(regex, payload)
    .concat(fromPullRequest(regex, payload))
    .concat(fromIssue(regex, payload))
    .filter((v, i, s) => s.indexOf(v) === i); // dedupe

  if (distinctMatches.length == 0) {
    console.log('no tags found');
    return;
  }

  getBoardId(boardIdentifier, apiKey, token).then(boardId => {
    if (!boardId) {
      if (!allowMissingBoard) {
        throw new Error('board could not be resolved, and missing board not allowed');
      } else {
        console.log('no board resolved, searching across all available boards');
      }
    }
    return Promise.all(distinctMatches
      .map(match => {
        return searchTrello(match.id, boardId, apiKey, token)
          .then(trelloCardId => {
            if (trelloCardId) {
              console.log(`attaching ${match.url} to card ${match.id}`);
              attachUrl(trelloCardId, match.id, match.url, match.title, apiKey, token);
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

function getMarkerRegex() {
  var marker = core.getInput('marker');
  console.log(`marker set as ${marker}`);
  if (/^[a-zA-Z]+-$/g.test(marker)) {
    marker = `\\b${marker}`; // must be own word
  }else if (/^[a-zA-Z]+$/g.test(marker)) {
    marker = `\\b${marker}`; // must be own word
  } else if (marker.length > 1) {
    throw new Error(' special character marker must be a single character');
  } else if (/^[!@#$%^&*+=]$/g.test(marker)) {
    marker = `\\${marker}`;
  } else {
    throw new Error("marker must be an alpha string, an alpha string followed by '-', or one of !@#$%^&*+=");
  }

  const regex = new RegExp(`${marker}[0-9]+\\b`, 'g');
  return regex;
}

function fromCommit(regex, payload) {
  if (!payload) {
    return [];
  }
  const commits = (payload && payload.commits && payload.commits.length || 0) > 0
    ? payload.commits
    : [payload.head_commit];

  return commits
    .filter(commit => !!(commit && commit.message))
    .map(commit => {
      console.log(`commit message: ${commit.message}`);
      return handleMatches(commit.message.match(regex), () => commit.url, () => commit.message);
    })
    .flat();
}

function fromPullRequest(regex, payload) {
  if (!payload) {
    return [];
  }
  const pullRequest = payload.pull_request;
  if (!pullRequest) {
    return [];
  }
  console.log(`PR title: ${pullRequest.title}`);
  const fromTitle = (pullRequest.title
    ? () => handleMatches(pullRequest.title.match(regex), () => pullRequest.html_url, () => pullRequest.title)
    : () => [])();
  console.log(`PR body: ${pullRequest.body}`);
  const fromBody = (pullRequest.body
    ? () => handleMatches(pullRequest.body.match(regex), () => pullRequest.html_url, () => pullRequest.title)
    : () => [])();

  return fromTitle.concat(fromBody);
}

function fromIssue(regex, payload) {
  if (!payload) {
    return [];
  }
  const issue = payload.issue;
  if (!issue) {
    return [];
  }
  console.log(`issue title: ${issue.title}`);
  const fromTitle = (issue.title
    ? () => handleMatches(issue.title.match(regex), () => issue.html_url, () => issue.title)
    : () => [])();
  console.log(`issue body: ${issue.body}`);
  const fromBody = (issue.body
    ? () => handleMatches(issue.body.match(regex), () => issue.html_url, () => issue.title)
    : () => [])();

  return fromTitle.concat(fromBody);
}

function handleMatches(matches, getUrlFn, getTitleFn) {
  if (matches) {
    return matches
      .filter((v, i, s) => s.indexOf(v) === i) // dedupe
      .map(match => {
        console.log(`found potential tag ${match}`);
        const numberMatches = match.match(/[0-9]+/g);
        return numberMatches && numberMatches[0];
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

function getBoardId(boardShortId, apiKey, token) {
  if (boardShortId) {
    return axios.get('https://api.trello.com/1/members/me/boards'
    + '?fields=id,name,shortLink'
    + `&key=${encodeURIComponent(apiKey)}`
    + `&token=${encodeURIComponent(token)}`)
    .then(resp => {
      const json = resp && resp.data;
      return json && json
        .filter(b => b.name === boardShortId || b.shortLink === boardShortId || b.id === boardShortId)
        .map(b => b.id)[0];
    });
  }
  return Promise.resolve(null);
}

function searchTrello(shortId, boardId, apiKey, token) {
  console.log(`searching trello board ${boardId} for card '${shortId}'`);
  return axios.get('https://api.trello.com/1/search'
    + `?query=${encodeURIComponent(shortId)}`
    + '&modelTypes=cards'
    + '&card_fields=id,idShort,name'
    + (boardId ? `&idBoards=${encodeURIComponent(boardId)}` : '')
    + `&key=${encodeURIComponent(apiKey)}`
    + `&token=${encodeURIComponent(token)}`)
  .then(resp => {
    const json = resp && resp.data;
    const relevantCards = json && json.cards && json.cards.filter(card => `${card.idShort}` === shortId).map(card => card.id);

    return relevantCards && relevantCards[0];
  });
}

function attachUrl(trelloCardId, shortId, url, title, apiKey, token) {
  return axios.post(`https://api.trello.com/1/cards/${encodeURIComponent(trelloCardId)}/attachments`
      + `?name=${encodeURIComponent(title)}`
      + `&url=${encodeURIComponent(url)}`
      + `&key=${encodeURIComponent(apiKey)}`
      + `&token=${encodeURIComponent(token)}`)
    .then(() => {
      console.log(`attached ${url} to card ${shortId}`);
    });
}
