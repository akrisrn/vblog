export const snippetMark = '--8<--';

export const destructors: (() => void)[] = [];

export function addEventListener(element: Document | Element, type: string, listener: EventListenerOrEventListenerObject) {
  element.addEventListener(type, listener);
  destructors.push(() => element.removeEventListener(type, listener));
}

export const inputBinds: Dict<() => void> = {};

export function addInputBinds(binds: Dict<() => void>) {
  Object.keys(binds).forEach(key => {
    inputBinds[key] = binds[key];
  });
}

export function chopStr(str: string, sep: string, trim = true): [string, string | null] {
  const indexOf = str.indexOf(sep);
  if (indexOf < 0) {
    return [str, null];
  }
  let key = str.substring(0, indexOf);
  let value = str.substring(indexOf + sep.length);
  if (trim) {
    key = key.trimEnd();
    value = value.trimStart();
  }
  return [key, value];
}
