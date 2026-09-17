/**
 * A stand-in for the claude.ai artifact runtime, injected before the page loads.
 * It gives the page an in-memory database with the same calls the real one has
 * (collection().onSnapshot, doc().get/set/update/onSnapshot), so the page can be
 * tested outside claude.ai. Tests reach it through window.__store and window.__seed.
 */
module.exports = `
(function(){
  var store = {receipts:{}, questions:{}, settings:{}, subscriptions:{}, files:{}, receivables:{}};
  var colSubs = [], docSubs = [];
  window.__store = store;
  function snapCol(name){
    return {docs: Object.keys(store[name]).map(function(id){ return {id:id, exists:true, data:function(){ return store[name][id]; }}; })};
  }
  function fireCol(name){ colSubs.filter(function(s){ return s[0] === name; }).forEach(function(s){ s[1](snapCol(name)); }); }
  function fireDoc(path){
    var p = path.split("/");
    docSubs.filter(function(s){ return s[0] === path; }).forEach(function(s){
      s[1]({exists: !!store[p[0]][p[1]], data: function(){ return store[p[0]][p[1]]; }});
    });
  }
  function collection(name){
    return {onSnapshot: function(fn){ colSubs.push([name, fn]); setTimeout(function(){ fireCol(name); }, 10); return function(){}; }};
  }
  function doc(path){
    var p = path.split("/"), c = p[0], id = p[1];
    return {
      get: function(){ return Promise.resolve({exists: !!store[c][id], data: function(){ return store[c][id]; }}); },
      set: function(o){ store[c][id] = o; setTimeout(function(){ fireCol(c); fireDoc(path); }, 5); return Promise.resolve(); },
      update: function(o){ store[c][id] = Object.assign({}, store[c][id] || {}, o); setTimeout(function(){ fireCol(c); fireDoc(path); }, 5); return Promise.resolve(); },
      onSnapshot: function(fn){ docSubs.push([path, fn]); setTimeout(function(){ fireDoc(path); }, 20); return function(){}; }
    };
  }
  window.__seed = function(col, docs){ Object.assign(store[col], docs); fireCol(col); };
  window.__setDoc = function(path, data){ var p = path.split("/"); store[p[0]][p[1]] = data; fireDoc(path); };
  window.claude = {use: function(name){ return Promise.resolve(name === "db" ? {collection: collection, doc: doc} : null); }};
})();
`;
