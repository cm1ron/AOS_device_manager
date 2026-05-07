// Jira REST API v3 클라이언트
// 인증: Basic (email:apiToken base64)
// 문서: https://developer.atlassian.com/cloud/jira/platform/rest/v3/

class JiraClient {
  constructor({ baseUrl, email, token }) {
    if (!baseUrl) throw new Error('Jira baseUrl 누락');
    if (!email) throw new Error('Jira email 누락');
    if (!token) throw new Error('Jira API token 누락');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.token = token;
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  async _request(method, path, { json, query, headers, raw } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const opts = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        ...(headers || {}),
      },
    };
    if (json !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(json);
    } else if (raw !== undefined) {
      opts.body = raw;
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`Jira ${method} ${path} → ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  myself() { return this._request('GET', '/rest/api/3/myself'); }

  getIssue(key, expand = 'names,schema,renderedFields') {
    return this._request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { expand } });
  }

  // 프로젝트의 createmeta (필드 정의)
  getCreateMeta(projectKey, issueTypeName = 'Bug') {
    return this._request('GET', `/rest/api/3/issue/createmeta`, {
      query: { projectKeys: projectKey, issuetypeNames: issueTypeName, expand: 'projects.issuetypes.fields' },
    });
  }

  async createIssue({ projectKey, issueType, summary, descriptionAdf, descriptionPanelAdf, labels, components, priority, severity, bugCategory, frequency, assigneeAccountId, extraFields }) {
    const fields = {
      project: { key: projectKey },
      issuetype: { name: issueType || 'Bug' },
      summary,
    };
    if (descriptionAdf) fields.description = descriptionAdf;
    if (descriptionPanelAdf) fields.customfield_10138 = descriptionPanelAdf;
    if (labels && labels.length) fields.labels = labels;
    if (components && components.length) fields.components = components.map((name) => ({ name }));
    if (priority) fields.priority = { name: priority };
    if (severity) fields.customfield_10084 = { value: severity };
    if (bugCategory) fields.customfield_10093 = { value: bugCategory };
    if (frequency) fields.customfield_10115 = { value: frequency };
    if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };
    if (extraFields && typeof extraFields === 'object') Object.assign(fields, extraFields);
    const body = await this._request('POST', '/rest/api/3/issue', { json: { fields } });
    return body;
  }

  async attachFile(issueKey, filePath, filename) {
    const fs = require('fs');
    const path = require('path');
    const buf = fs.readFileSync(filePath);
    const fname = filename || path.basename(filePath);
    const boundary = '----QAManagerBoundary' + Date.now();
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fname}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, buf, tail]);
    return this._request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
      raw: body,
      headers: {
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    });
  }

  async attachBuffer(issueKey, buffer, filename) {
    const boundary = '----QAManagerBoundary' + Date.now();
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, buffer, tail]);
    return this._request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
      raw: body,
      headers: {
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    });
  }

  // 트랜지션 목록 조회
  listTransitions(issueKey) {
    return this._request('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
  }

  // 트랜지션 실행
  doTransition(issueKey, transitionId) {
    return this._request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      json: { transition: { id: String(transitionId) } },
    });
  }

  // 댓글 작성. bodyAdf 는 ADF doc 객체.
  addComment(issueKey, bodyAdf) {
    return this._request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      json: { body: bodyAdf },
    });
  }

  // 프로젝트의 components 목록
  async listComponents(projectKey) {
    return this._request('GET', `/rest/api/3/project/${encodeURIComponent(projectKey)}/components`);
  }

  // 프로젝트에 사용된 라벨 (전역 자동완성)
  async suggestLabels(query = '') {
    return this._request('GET', `/rest/api/3/label`, { query: { startAt: 0, maxResults: 100 } });
  }
}

// description ADF (Atlassian Document Format) 헬퍼
// plain text + 헤딩 섹션을 ADF 로 변환
function buildDescriptionAdf(sections /* [{heading, text}] */) {
  const content = [];
  for (const sec of sections) {
    if (sec.heading) {
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: sec.heading }],
      });
    }
    const lines = String(sec.text || '').split('\n');
    if (lines.length === 1 && !lines[0]) continue;
    content.push({
      type: 'paragraph',
      content: lines.flatMap((line, i) => {
        const arr = [];
        if (line) arr.push({ type: 'text', text: line });
        if (i < lines.length - 1) arr.push({ type: 'hardBreak' });
        return arr;
      }),
    });
  }
  return { type: 'doc', version: 1, content };
}

// 5개 warning panel 형태의 ADF (QA 프로젝트 "설명" 커스텀 필드 양식과 동일 구조)
// sections: [{heading: '🐞 빌드 버전', text: '...'}]
// text 는 줄바꿈 포함된 plain string
function buildDescriptionPanelAdf(sections) {
  const content = sections.map((sec) => {
    const rawLines = String(sec.text || '').split('\n');
    let bodyParas;

    if (sec.kind === 'list') {
      // "1. xxx", "2. xxx" 같은 줄들을 numbered list 로. 비면 빈 항목 1개
      const items = rawLines
        .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim())
        .filter((_, idx, arr) => idx < arr.length || true);
      const cleanItems = items.length ? items : [''];
      bodyParas = [{
        type: 'orderedList',
        content: cleanItems.map((t) => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: t ? [{ type: 'text', text: t }] : [],
          }],
        })),
      }];
    } else if (rawLines.length === 1 && rawLines[0] === '') {
      bodyParas = [{ type: 'paragraph' }];
    } else {
      const para = { type: 'paragraph', content: [] };
      rawLines.forEach((line, i) => {
        if (line) para.content.push({ type: 'text', text: line });
        if (i < rawLines.length - 1) para.content.push({ type: 'hardBreak' });
      });
      bodyParas = [para.content.length === 0 ? { type: 'paragraph' } : para];
    }

    return {
      type: 'panel',
      attrs: { panelType: 'warning' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: sec.heading, marks: [{ type: 'strong' }] }],
        },
        ...bodyParas,
      ],
    };
  });
  return { type: 'doc', version: 1, content };
}

module.exports = { JiraClient, buildDescriptionAdf, buildDescriptionPanelAdf };
