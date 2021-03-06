import { config } from '@/ts/config';
import { getIcon } from '@/ts/element';
import { EIcon, EMark } from '@/ts/enums';
import { addBaseUrl, homePath, isExternalLink, shortenPath } from '@/ts/path';
import { getMarkRegExp } from '@/ts/regexp';
import { chopStr } from '@/ts/utils';
import { replaceByRegExp, trimList } from '@/ts/async/utils';
import MarkdownIt from 'markdown-it';
import Token from 'markdown-it/lib/token';
import { fromCodePoint } from 'markdown-it/lib/common/utils';

const quotes = config.smartQuotes;

const markdownIt = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true,
  quotes,
});
markdownIt.linkify.tlds([], false);

if (!quotes || quotes.length < 4) {
  markdownIt.disable('smartquotes');
}

[
  require('markdown-it-deflist'),
  require('markdown-it-footnote'),
  require('markdown-it-task-lists'),
].forEach(plugin => markdownIt.use(plugin));

let isRenderingSummary = false;
const detailsRegExp = /^\s+(open\s+)?(?:\.(.*?)\s+)?(.*)$/;

// noinspection JSUnusedGlobalSymbols
markdownIt.use(require('markdown-it-container'), 'details', {
  validate: (params: string) => params.match(detailsRegExp) || params === '',
  render: (tokens: Token[], idx: number) => {
    const token = tokens[idx];
    if (token.nesting !== 1) {
      return '</details>';
    }
    let isOpen = true;
    let classList: string[] = [];
    let summary = '';
    const match = token.info.match(detailsRegExp);
    if (!match) {
      classList.push('empty');
    } else {
      const [, openMatch, classMatch, summaryMatch] = match;
      if (classMatch) {
        classList = trimList(classMatch.split('.'));
      }
      if (!classList.includes('empty')) {
        if (!openMatch) {
          isOpen = false;
        }
        if (summaryMatch !== '\\') {
          isRenderingSummary = true;
          summary = markdownIt.renderInline(summaryMatch);
          isRenderingSummary = false;
        }
      }
    }
    let attrs = '';
    if (isOpen) {
      attrs += ' open';
    }
    if (classList.length > 0) {
      attrs += ` class="${classList.join(' ')}"`;
    }
    return `<details${attrs}><summary>${summary}</summary>`;
  },
});

markdownIt.renderer.rules.footnote_block_open = () => {
  return `<section class="footnotes"><p>${config.messages.footnotes}</p><ol class="footnotes-list">`;
};

const getDefaultRenderRule = (name: string) => {
  return markdownIt.renderer.rules[name] || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
};

const replacerList: [RegExp, string][] = [];
if (config.replacer) {
  config.replacer.forEach(item => {
    try {
      replacerList.push([new RegExp(item[0], 'g'), item[1]]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  });
}

const defaultTextRenderRule = getDefaultRenderRule('text');
markdownIt.renderer.rules.text = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  let content = token.content;
  content = replaceByRegExp(/(\\u[0-9a-f]{4}|u\+[0-9a-f]{4,6})/ig, content, ([, match]) => {
    const code = parseInt(match.substr(2), 16);
    return match.startsWith('\\') ? String.fromCharCode(code) : fromCodePoint(code);
  });
  replacerList.forEach(item => {
    content = content.replace(item[0], item[1]);
  });
  token.content = content;
  return defaultTextRenderRule(tokens, idx, options, env, self);
};

const defaultFenceRenderRule = getDefaultRenderRule('fence');
markdownIt.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.tag !== 'code') {
    return defaultFenceRenderRule(tokens, idx, options, env, self);
  }
  let dataLine = '';
  let lang = token.info.trim();
  const [key, value] = chopStr(lang, '|');
  if (value !== null) {
    lang = key;
    dataLine = value;
  }
  token.info = lang;
  if (lang) {
    token.attrJoin('class', 'line-numbers');
    if (dataLine) {
      token.attrSet('data-line', dataLine);
    }
  }
  return defaultFenceRenderRule(tokens, idx, options, env, self);
};

const defaultTheadRenderRule = getDefaultRenderRule('thead_open');
markdownIt.renderer.rules.thead_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  let isEmpty = true;
  let i = idx + 2;
  do {
    const thToken = tokens[i];
    if (thToken.type === 'inline' && thToken.content) {
      isEmpty = false;
      break;
    }
    i += 1;
  } while (tokens[i].type !== 'tr_close');
  if (isEmpty) {
    token.attrJoin('class', 'hidden');
  }
  return defaultTheadRenderRule(tokens, idx, options, env, self);
};

let headingCount: Dict<number> = {};

const defaultHeadingRenderRule = getDefaultRenderRule('heading_open');
markdownIt.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (isRenderingSummary || token.level !== 0) {
    return defaultHeadingRenderRule(tokens, idx, options, env, self);
  }
  const nextToken = tokens[idx + 1];
  const match = nextToken.content.match(/^\+\s+/);
  if (match) {
    const textToken = nextToken.children![0];
    textToken.content = textToken.content.substr(match[0].length);
    token.attrJoin('class', 'fold');
  }
  const tag = token.tag;
  let count = headingCount[tag];
  count = count === undefined ? 1 : (count + 1);
  headingCount[tag] = count;
  token.attrSet('id', `${tag}-${count}`);
  const html = `<span class="heading-tag">H<small>${tag.substr(1)}</small></span>`;
  return defaultHeadingRenderRule(tokens, idx, options, env, self) + html;
};

const defaultHeadingCloseRenderRule = getDefaultRenderRule('heading_close');
markdownIt.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (isRenderingSummary || token.level !== 0) {
    return defaultHeadingCloseRenderRule(tokens, idx, options, env, self);
  }
  const html = `<span class="heading-link">${getIcon(EIcon.link, 14)}</span>`;
  return html + defaultHeadingCloseRenderRule(tokens, idx, options, env, self);
};

const defaultImageRenderRule = getDefaultRenderRule('image');
markdownIt.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet('src');
  if (!src) {
    return defaultImageRenderRule(tokens, idx, options, env, self);
  }
  if (!isExternalLink(src)) {
    token.attrSet('src', addBaseUrl(src));
  }
  const title = token.attrGet('title');
  if (!title) {
    return defaultImageRenderRule(tokens, idx, options, env, self);
  }
  const [key, value] = chopStr(title, '#', false, true);
  if (value === null) {
    return defaultImageRenderRule(tokens, idx, options, env, self);
  }
  const width = parseInt(value);
  if (!isNaN(width)) {
    token.attrSet('width', `${width}`);
  } else if (value.startsWith('.')) {
    trimList(value.split('.')).forEach(cls => token.attrJoin('class', cls));
  } else {
    token.attrSet('style', value);
  }
  if (key) {
    token.attrSet('title', key);
  } else {
    token.attrs!.splice(token.attrIndex('title'), 1);
  }
  return defaultImageRenderRule(tokens, idx, options, env, self);
};

let isExternal = false;

const defaultLinkRenderRule = getDefaultRenderRule('link_open');
markdownIt.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  let href = token.attrGet('href');
  if (!href) {
    return defaultLinkRenderRule(tokens, idx, options, env, self);
  }
  if (isExternalLink(href)) {
    token.attrSet('rel', 'noopener noreferrer');
    token.attrSet('target', '_blank');
    isExternal = true;
    return defaultLinkRenderRule(tokens, idx, options, env, self);
  }
  isExternal = false;
  if (href.startsWith('/') && (href.endsWith('.md') || href.endsWith('/'))) {
    const title = token.attrGet('title');
    if (title) {
      const [key, value] = chopStr(title, '#', false, true);
      if (value !== null) {
        href = `#${shortenPath(href)}`;
        const [anchor, query] = chopStr(value, '?', false);
        if (anchor) {
          href += `#${anchor}`;
        }
        if (query) {
          href += `?${query}`;
        }
        if (key) {
          token.attrSet('title', key);
        } else {
          token.attrs!.splice(token.attrIndex('title'), 1);
        }
      }
    }
  }
  href = addBaseUrl(href);
  token.attrSet('href', href);
  if (!href.startsWith('#') && href !== homePath) {
    token.attrSet('target', '_blank');
  }
  return defaultLinkRenderRule(tokens, idx, options, env, self);
};

const defaultLinkCloseRenderRule = getDefaultRenderRule('link_close');
markdownIt.renderer.rules.link_close = (tokens, idx, options, env, self) => {
  const icon = isExternal ? getIcon(EIcon.external, 14) : '';
  return icon + defaultLinkCloseRenderRule(tokens, idx, options, env, self);
};

export function parseMD(data: string) {
  return markdownIt.parse(data.trim(), {});
}

export function renderMD(data: string, replaceMark = true) {
  if (replaceMark) {
    data = data.replace(getMarkRegExp(EMark.slice, true, 'img'), '');
    let replaced = false;
    data = replaceByRegExp(getMarkRegExp(EMark.toc, true, 'img'), data, () => {
      if (!replaced) {
        replaced = true;
        return '<div id="toc"></div>';
      }
      return '';
    });
  }
  headingCount = {};
  return markdownIt.render(data.trim()).trim();
}

export { markdownIt };
export * from '@/ts/async/update';
