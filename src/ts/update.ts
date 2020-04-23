import { getIndexFileData, getListFromData, setFlag } from '@/ts/data';
import { getDateString, getTime } from '@/ts/date';
import { EFlag } from '@/ts/enums';
import { renderMD } from '@/ts/markdown';
import { buildQueryContent, getQueryContent, getQueryTypeAndParam } from '@/ts/query';
import resource from '@/ts/resource';
import { scroll } from '@/ts/scroll';
import { escapeHTML, getWrapRegExp, splitFlag } from '@/ts/utils';
import axios from 'axios';

export function updateDD() {
  document.querySelectorAll<HTMLParagraphElement>('article p').forEach((p) => {
    if (p.innerText.startsWith(': ')) {
      const dl = document.createElement('dl');
      const dd = document.createElement('dd');
      dl.append(dd);
      dd.innerHTML = p.innerHTML.substr(2);
      p.outerHTML = dl.outerHTML;
    }
  });
  document.querySelectorAll<HTMLDetailsElement>('article dt').forEach((dt) => {
    if (dt.innerText.startsWith(': ')) {
      const dd = document.createElement('dd');
      dd.innerHTML = dt.innerHTML.substr(2);
      dt.outerHTML = dd.outerHTML;
    }
  });
}

export function updateToc() {
  const uls = document.querySelectorAll<HTMLUListElement>('#toc > ul');
  if (uls.length === 2) {
    uls[0].classList.add('ul-a');
    uls[1].classList.add('ul-b');
  }
  document.querySelectorAll<HTMLLinkElement>('#toc a').forEach((a) => {
    let href = a.getAttribute('h');
    if (href === null) {
      href = a.getAttribute('href')!;
      a.setAttribute('h', href);
      a.removeAttribute('href');
    }
    let innerText = a.innerText;
    const nextSibling = a.nextElementSibling as HTMLElement;
    if (nextSibling && nextSibling.classList.value === 'count') {
      innerText += nextSibling.innerText;
    }
    a.addEventListener('click', (e) => {
      e.preventDefault();
      for (const h of document.querySelectorAll<HTMLHeadingElement>(`article ${href}`)) {
        if (h.innerText === innerText) {
          scroll(h.offsetTop - 10);
          break;
        }
      }
    });
  });
  document.querySelectorAll<HTMLLinkElement>('#toc > ul.tags > li > a').forEach((a) => {
    const count = a.querySelector<HTMLSpanElement>('span.count');
    if (count) {
      a.removeChild(count);
      a.parentElement!.append(count);
      const fontSize = Math.log10(parseInt(count.innerText.substr(1), 0)) + 1;
      if (fontSize > 1) {
        a.style.fontSize = fontSize + 'em';
      }
    }
  });
}

export function updateHeading() {
  document.querySelectorAll<HTMLHeadingElement>([1, 2, 3, 4, 5, 6].map((item) => {
    return `article h${item}`;
  }).join(',')).forEach((h) => {
    let link = h.querySelector('.heading-link');
    if (!link) {
      link = document.createElement('a');
      link.classList.add('heading-link');
      h.append(link);
    }
    link.addEventListener('click', () => {
      scroll(h.offsetTop - 10);
    });
  });
}

export function updateFootnote() {
  document.querySelectorAll<HTMLLinkElement>('article .footnote-backref').forEach((backref, i) => {
    const fnref = document.getElementById(`fnref${i + 1}`);
    if (fnref) {
      fnref.addEventListener('click', (e) => {
        e.preventDefault();
        scroll(backref.offsetTop - 10);
      });
      fnref.removeAttribute('href');
      backref.addEventListener('click', (e) => {
        e.preventDefault();
        scroll(fnref.offsetTop - 10);
      });
      backref.removeAttribute('href');
    }
  });
}

export function updateImagePath() {
  document.querySelectorAll<HTMLImageElement>('article img, #cover img').forEach((img) => {
    let parent = img.parentElement!;
    if (['A', 'PICTURE'].includes(parent.tagName)) {
      parent = parent.parentElement!;
    }
    img.classList.forEach((cls) => {
      if (['hidden', 'left', 'right'].includes(cls)) {
        parent.classList.add(cls);
        img.classList.remove(cls);
      }
    });
    let loadings = parent.previousElementSibling;
    if (!parent.classList.contains('hidden') || (loadings && loadings.classList.contains('lds-ellipsis'))) {
      parent.classList.add('hidden');
      if (!loadings || !loadings.classList.contains('lds-ellipsis')) {
        loadings = document.createElement('div');
        loadings.classList.add('lds-ellipsis');
        for (let i = 0; i < 4; i++) {
          loadings.append(document.createElement('div'));
        }
        parent.parentElement!.insertBefore(loadings, parent);
      }
      if (img.naturalWidth === 0) {
        img.onload = () => {
          parent.classList.remove('hidden');
          loadings!.remove();
        };
      } else {
        parent.classList.remove('hidden');
        loadings.remove();
      }
    }
    if (['DT', 'PICTURE'].includes(parent.tagName)) {
      parent.parentElement!.classList.add('center');
    } else {
      if (parent.parentElement!.tagName !== 'BLOCKQUOTE') {
        parent.classList.add('center');
      }
    }
  });
}

export function updateTextCount() {
  const textCount = document.querySelector<HTMLElement>('#text-count');
  if (textCount) {
    let count = 0;
    document.querySelectorAll('article > *:not(#toc):not(pre)').forEach((element) => {
      if (element.textContent) {
        count += element.textContent.replace(/\s/g, '').length;
      }
    });
    const countStr = count.toString();
    const countList = [];
    let start = 0;
    for (let i = Math.floor(countStr.length / 3); i >= 0; i--) {
      const end = countStr.length - i * 3;
      if (end === 0) {
        continue;
      }
      countList.push(countStr.substring(start, end));
      start = end;
    }
    textCount.innerHTML = countList.join(',');
  }
}

export function updateLinkPath(isCategory: boolean, updatedLinks: string[] = []) {
  // 匹配模式：
  // 1. 链接地址以 # 结尾：将链接转换成 hash 路由形式
  // 2. 链接地址以 #/ 结尾：将链接转换成 history 路由 / 预渲染形式
  // 3. text 为 +，或形如 +#a=1|b=2|3：将链接引入为片段模板，后者为传参写法
  //      #a=1|b=2|3 会被转化成 {1: 1, 2: 2, 3: 3, a: 1, b: 2}
  // 4. text 为 *：将链接引入为 JavaScript 文件引用
  // 5. text 为 $：将链接引入为 CSS 文件引用
  for (const a of document.querySelectorAll<HTMLLinkElement>('article a[href]')) {
    const text = a.innerText;
    const href = a.getAttribute('href')!;
    const pathname = new URL(a.href).pathname;
    if (href.endsWith('.md#')) {
      a.href = '#' + pathname;
    } else if (href.endsWith('.md#/')) {
      a.href = pathname.replace(/\.md$/, '.html');
    } else if (text.match(/^\+(?:#.+)?$/)) {
      a.classList.add('snippet');
      if (updatedLinks.includes(href)) {
        continue;
      }
      const params: { [index: string]: string | undefined } = {};
      const match = text.match(/#(.+)$/);
      if (match) {
        match[1].split('|').forEach((seg, i) => {
          let param = seg;
          const paramMatch = seg.match(/(.+?)=(.+)/);
          if (paramMatch) {
            param = paramMatch[2];
            params[paramMatch[1]] = param;
          }
          params[i + 1] = param;
        });
      }
      axios.get(href).then((response) => {
        let data = (response.data as string).split('\n').map((line) => {
          const paramMatches = line.match(getWrapRegExp('{{', '}}', 'g'));
          if (paramMatches) {
            paramMatches.forEach((paramMatch) => {
              const m = paramMatch.match(getWrapRegExp('{{', '}}'))!;
              let defaultValue;
              [m[1], defaultValue] = m[1].split('|');
              const param = params[m[1]];
              let result: string;
              if (param !== undefined) {
                result = param;
              } else if (defaultValue !== undefined) {
                result = defaultValue;
              } else {
                result = 'undefined';
              }
              line = line.replace(m[0], result.replace(/\\n/g, '\n'));
            });
            return line;
          }
          return line;
        }).join('\n');
        if (params.clip !== undefined) {
          const slips = data.split('--8<--');
          let num = parseInt(params.clip, 0);
          if (isNaN(num)) {
            if (params.clip === 'random') {
              num = Math.floor(Math.random() * slips.length);
            } else {
              num = 0;
            }
          } else if (num < 0) {
            num = 0;
          } else if (num >= slips.length) {
            num = slips.length - 1;
          }
          data = slips[num];
        }
        // 规避递归节点重复问题。
        try {
          a.parentElement!.outerHTML = renderMD(data, isCategory, true);
        } catch (e) {
          return;
        }
        updateDD();
        updateImagePath();
        updateTextCount();
        updatedLinks.push(href);
        updateLinkPath(isCategory, updatedLinks);
      }).catch((error) => {
        a.parentElement!.innerHTML = `${error.response.status} ${error.response.statusText}`;
      });
    } else if (text === '*') {
      if (!document.querySelector(`script[src='${href}']`)) {
        const script = document.createElement('script');
        script.classList.add('custom');
        script.src = href;
        document.body.appendChild(script);
      }
      a.parentElement!.remove();
    } else if (text === '$') {
      if (!document.querySelector(`link[href='${href}']`)) {
        const link = document.createElement('link');
        link.classList.add('custom');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = href;
        document.head.appendChild(link);
      }
      a.parentElement!.remove();
    } else if (href.startsWith('http://') || href.startsWith('https://')) {
      // noinspection JSDeprecatedSymbols
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
}

export function updateIndexList(isCategory: boolean) {
  document.querySelectorAll('article ul:not(.toc)').forEach((ul) => {
    const lis: Array<{ node: HTMLLIElement, time: number }> = [];
    ul.querySelectorAll('li').forEach((li) => {
      const item = {
        node: li,
        time: 0,
      };
      let date = li.querySelector<HTMLSpanElement>('span.date');
      if (!date) {
        const link = li.querySelector('a');
        if (link) {
          const dateString = getDateString(link.href);
          if (dateString) {
            date = document.createElement('span');
            date.classList.add('date');
            date.innerText = dateString;
            li.insertBefore(date, link);
            item.time = getTime(link.href);
          }
        }
      }
      li.querySelectorAll<HTMLElement>('code:not(.nolink)').forEach((code) => {
        const a = document.createElement('a');
        a.href = buildQueryContent(`@${EFlag.tags}:${code.innerText}`, true);
        a.innerText = code.innerText;
        code.innerHTML = a.outerHTML;
      });
      lis.push(item);
    });
    let maxSize = process.env.VUE_APP_MAX_SIZE_OF_LIST;
    if (isCategory) {
      maxSize = 5;
    }
    ul.innerHTML = lis.sort((a, b) => b.time - a.time).map((li, i) => {
      if (i >= maxSize) {
        li.node.classList.add('hidden');
      }
      return li.node.outerHTML;
    }).join('');
    if (lis.length > maxSize) {
      const more = document.createElement('div');
      more.classList.add('more');
      const moreSpan = document.createElement('span');
      moreSpan.innerText = 'More';
      moreSpan.addEventListener('click', () => {
        ul.querySelectorAll('li.hidden').forEach((li) => {
          li.classList.remove('hidden');
        });
        more.classList.add('hidden');
      });
      more.append(moreSpan);
      ul.append(more);
    }
  });
}

export function updateCategoryListActual(syncData: string, updateData: (data: string) => void, isCategory: boolean) {
  return (pageData: string) => {
    const list = getListFromData(pageData);
    if (list.length > 0) {
      const tagDict: { [index: string]: string[] | undefined } = {};
      const untagged = [];
      for (const item of list) {
        if (item.tags.length === 0) {
          untagged.push(`- [${item.title}](${item.href})`);
          continue;
        }
        const tags = item.tags.map((tag) => {
          return '`' + tag + '`';
        }).join(' ');
        item.tags.forEach((tag) => {
          if (tagDict[tag] === undefined) {
            tagDict[tag] = [];
          }
          tagDict[tag]!.push(`- [${item.title}](${item.href}) ${tags}`);
        });
      }
      const sortedKeys = Object.keys(tagDict).sort();
      if (untagged.length > 0) {
        sortedKeys.unshift(process.env.VUE_APP_UNTAGGED);
        tagDict[process.env.VUE_APP_UNTAGGED] = untagged;
      }
      updateData(syncData.replace('[list]', sortedKeys.map((key) => {
        const count = `<span class="count">（${tagDict[key]!.length}）</span>`;
        return `###### ${key}${count}\n\n${tagDict[key]!.join('\n')}`;
      }).join('\n\n')));
      setTimeout(() => {
        updateToc();
        updateHeading();
        updateLinkPath(isCategory);
        updateIndexList(isCategory);
        updateTextCount();
      }, 0);
    }
  };
}

export function updateCategoryList(syncData: string, updateData: (data: string) => void, isCategory: boolean) {
  getIndexFileData(updateCategoryListActual(syncData, updateData, isCategory));
}

export function updateSearchListActual(params: { [index: string]: string | undefined }, isCategory: boolean) {
  return (pageData: string) => {
    const queryContent = getQueryContent(params).toLowerCase();
    const [queryType, queryParam] = getQueryTypeAndParam(queryContent);
    const resultUl = document.querySelector<HTMLUListElement>('ul#result')!;
    const list = getListFromData(pageData, true);
    if (list.length > 0) {
      const header = document.querySelector('header')!;
      let count = 0;
      const timeStart = new Date().getTime();
      list.forEach((item) => {
        axios.get(item.href).then((response) => {
          const data = response.data.trim();
          let isFind: boolean;
          if (queryType === EFlag.author) {
            let dataAuthor = process.env.VUE_APP_AUTHOR;
            setFlag(data, `@${EFlag.author}:`, (match) => {
              dataAuthor = match;
            });
            isFind = dataAuthor.toLowerCase() === queryParam;
          } else if (queryType === EFlag.tags) {
            let dataTags: string[] = [];
            setFlag(data, `@${EFlag.tags}:`, (match) => {
              dataTags = splitFlag(match.toLowerCase());
            });
            isFind = dataTags.includes(queryParam!);
          } else {
            isFind = data.toLowerCase().indexOf(queryContent) >= 0;
          }
          if (isFind) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = item.href;
            a.innerText = item.title;
            li.append(a);
            item.tags.forEach((tag) => {
              const code = document.createElement('code');
              code.innerText = tag;
              li.append(' ');
              li.append(code);
            });
            if (!queryType) {
              const results = [];
              let prevEndIndex = 0;
              const regexp = new RegExp(queryContent, 'ig');
              let match = regexp.exec(data);
              while (match !== null) {
                const offset = 10;
                let startIndex = match.index - offset;
                if (prevEndIndex === 0 && startIndex > 0) {
                  results.push('');
                }
                const endIndex = regexp.lastIndex + offset;
                const lastIndex = results.length - 1 as number;
                let result = `<span class="hl">${escapeHTML(match[0])}</span>` +
                  escapeHTML(data.substring(match.index + match[0].length, endIndex).trimEnd());
                if (startIndex <= prevEndIndex) {
                  startIndex = prevEndIndex;
                  if (startIndex > match.index) {
                    if (lastIndex >= 0) {
                      const lastResult = results[lastIndex] as string;
                      results[lastIndex] = lastResult.substring(0, lastResult.length - (startIndex - match.index));
                    }
                  } else if (startIndex < match.index) {
                    result = escapeHTML(data.substring(startIndex, match.index).trimStart()) + result;
                  }
                  if (lastIndex >= 0) {
                    results[lastIndex] += result;
                  } else {
                    results.push(result);
                  }
                } else {
                  results.push(escapeHTML(data.substring(startIndex, match.index).trimStart()) + result);
                }
                prevEndIndex = endIndex;
                match = regexp.exec(data);
              }
              if (prevEndIndex < data.length) {
                results.push('');
              }
              const blockquote = document.createElement('blockquote');
              const p = document.createElement('p');
              p.innerHTML = results.join('<span class="ellipsis">...</span>');
              blockquote.append(p);
              li.append(blockquote);
            }
            resultUl.append(li);
            updateLinkPath(isCategory);
            updateIndexList(isCategory);
            updateTextCount();
          }
        }).finally(() => {
          if (++count === list.length) {
            header.innerText = resource.searchDone;
            const searchTime = document.querySelector<HTMLSpanElement>('span#search-time');
            if (searchTime) {
              searchTime.innerText = ((new Date().getTime() - timeStart) / 1000).toString();
            }
            const searchCount = document.querySelector<HTMLSpanElement>('span#search-count');
            if (searchCount) {
              searchCount.innerText = `${resultUl.childElementCount}/${list.length}`;
            }
          } else {
            header.innerText = `${resource.searching}(${count}/${list.length})`;
          }
        });
      });
    }
    if (resultUl.childElementCount === 0) {
      resultUl.innerText = resource.searchNothing;
    }
  };
}

export function updateSearchList(params: { [index: string]: string | undefined }, isCategory: boolean) {
  const queryContent = getQueryContent(params);
  const resultUl = document.querySelector('ul#result');
  const searchInput = document.querySelector<HTMLInputElement>('input#search-input');
  if (searchInput) {
    searchInput.value = queryContent;
    searchInput.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchInput.value = searchInput.value.trim();
        const param = searchInput.value ? buildQueryContent(searchInput.value) : '';
        const indexOf = location.href.indexOf('?');
        location.href = ((indexOf >= 0) ? location.href.substring(0, indexOf) : location.href) + param;
      }
    });
  }
  if (queryContent && resultUl) {
    getIndexFileData(updateSearchListActual(params, isCategory));
  }
}
