/**
 * Whether an address a source gave is one the page may link to or open: absolute http(s), the rule every link field of
 * the contracts holds a source to (`SourceLinkSchema`, D145 item 5). The server checks it; the page checks it again
 * before it opens one, so no other scheme reaches the browser through a field that slipped the check.
 */
export const isWebAddress = (value: string) => /^https?:\/\/[^\s]+$/i.test(value);
