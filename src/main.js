import * as THREE from "three";
import sdk from "@playabl/sdk";
import { createGame } from "./game.js"; // Путь изменен на локальный
import tweaksManifest from "./tweaks.json";
import assetsManifest from "./assets.json";
import "./styles.css";

const app = document.querySelector("#app");
const ready = await sdk.ready();
const tweaks = await sdk.tweaks.init(tweaksManifest);
const assets = Object.keys(assetsManifest).length > 0
  ? await sdk.assets.register(assetsManifest)
  : undefined;

const scene = new THREE.Scene();
scene.name = "Playabl Crypto Clicker Scene";
scene.userData = {
  source: "playabl-crypto-clicker",
  authoringFormat: "three-object-json",
};

const game = createGame({ mount: app, sdk, ready, tweaks, assets });
game.start();
