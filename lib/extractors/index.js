// lib/extractors/index.js — DOM extraction registry & barrel export
// Assembles DOM_EXTRACTORS from platforms/ and houses/ directories,
// wires up aliases, and re-exports runner functions.

// ── Platform extractors ──
import eigModule, { aliases as eigAliases } from './platforms/eig.js';
import iamsoldModule, { aliases as iamsoldAliases } from './platforms/iamsold.js';
import bambooModule, { aliases as bambooAliases } from './platforms/bamboo.js';
import homeflowModule, { aliases as homeflowAliases } from './platforms/homeflow.js';
import sdlModule, { aliases as sdlAliases } from './platforms/sdl.js';
import auctionHouseUkModule, { aliases as auctionHouseUkAliases } from './platforms/auction-house-uk.js';
import auction2Module from './platforms/auction2.js';
import countrywideModule from './platforms/countrywide.js';
import eigWhitelabelModule, { aliases as eigWhitelabelAliases } from './platforms/eig-whitelabel.js';

// ── House extractors ──
import savills from './houses/savills.js';
import bondwolfe from './houses/bondwolfe.js';
import network from './houses/network.js';
import barnardmarcus, { aliases as barnardmarcusAliases } from './houses/barnardmarcus.js';
import auctionhouselondon from './houses/auction-house-london.js';
import cliveemson from './houses/cliveemson.js';
import strettons from './houses/strettons.js';
import acuitus from './houses/acuitus.js';
import pattinson from './houses/pattinson.js';
import bidx1 from './houses/bidx1.js';
import philliparnold from './houses/philliparnold.js';
import edwardmellor from './houses/edwardmellor.js';
import barnettross from './houses/barnettross.js';
import cottons from './houses/cottons.js';
import dedmangray from './houses/dedmangray.js';
import probateauction from './houses/probateauction.js';
import connectuk from './houses/connectuk.js';
import auctionestates from './houses/auctionestates.js';
import loveitts from './houses/loveitts.js';
import robinsonhall from './houses/robinson-hall.js';
import goldings from './houses/goldings.js';
import dawsons from './houses/dawsons.js';
import durrants from './houses/durrants.js';
import agentsproperty from './houses/agentsproperty.js';
import andrewcraig from './houses/andrewcraig.js';
import buttersjohnbee from './houses/buttersjohnbee.js';
import cheffins from './houses/cheffins.js';
import fssproperty from './houses/fssproperty.js';
import wilsons from './houses/wilsons.js';
import strakers from './houses/strakers.js';
import underthehammer from './houses/underthehammer.js';
import symondsandsampson from './houses/symonds-and-sampson.js';
import shonkibros from './houses/shonkibros.js';
import bagshaws from './houses/bagshaws.js';
import propertysolvers from './houses/propertysolvers.js';
import pugh from './houses/pugh.js';
import pearsons from './houses/pearsons.js';
import nesbits from './houses/nesbits.js';
import smithandsons from './houses/smithandsons.js';
import brutonknowles from './houses/brutonknowles.js';
import mccartneys from './houses/mccartneys.js';
import bramleys from './houses/bramleys.js';
import morrismarshall from './houses/morrismarshall.js';
import cleetompkinson from './houses/cleetompkinson.js';

// ═══════════════════════════════════════════════════════════════
// Assemble DOM_EXTRACTORS from all sources
// ═══════════════════════════════════════════════════════════════
export const DOM_EXTRACTORS = {
  // Platforms
  ...eigModule,
  ...iamsoldModule,
  ...bambooModule,
  ...homeflowModule,
  ...sdlModule,
  ...auctionHouseUkModule,
  ...auction2Module,
  ...countrywideModule,
  ...eigWhitelabelModule,
  // Houses
  ...savills,
  ...bondwolfe,
  ...network,
  ...barnardmarcus,
  ...auctionhouselondon,
  ...cliveemson,
  ...strettons,
  ...acuitus,
  ...pattinson,
  ...bidx1,
  ...philliparnold,
  ...edwardmellor,
  ...barnettross,
  ...cottons,
  ...dedmangray,
  ...probateauction,
  ...connectuk,
  ...auctionestates,
  ...loveitts,
  ...robinsonhall,
  ...goldings,
  ...dawsons,
  ...durrants,
  ...agentsproperty,
  ...andrewcraig,
  ...buttersjohnbee,
  ...cheffins,
  ...fssproperty,
  ...wilsons,
  ...strakers,
  ...underthehammer,
  ...symondsandsampson,
  ...shonkibros,
  ...bagshaws,
  ...propertysolvers,
  ...pugh,
  ...pearsons,
  ...nesbits,
  ...smithandsons,
  ...brutonknowles,
  ...mccartneys,
  ...bramleys,
  ...morrismarshall,
  ...cleetompkinson,
};

// ── Wire up platform aliases ──
function applyAliases(aliases) {
  for (const [alias, base] of Object.entries(aliases)) {
    DOM_EXTRACTORS[alias] = DOM_EXTRACTORS[base];
  }
}

applyAliases(eigAliases);
applyAliases(iamsoldAliases);
applyAliases(bambooAliases);
applyAliases(homeflowAliases);
applyAliases(sdlAliases);
applyAliases(auctionHouseUkAliases);
applyAliases(barnardmarcusAliases);
applyAliases(eigWhitelabelAliases);

// ── Re-export runner functions ──
export { extractWithJSDOM, initExtractors, resetBrokenExtractors, getLastExtractorUsed, setLastExtractorUsed } from './runner.js';
export { UNIVERSAL_DOM_EXTRACTOR } from './universal.js';
export { IMG_HELPERS } from './helpers.js';
