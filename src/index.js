import './style.css';

import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { BirdGeometry } from './BirdGeometry.js';
import { BoidsSimulation } from './simulation.js';

import birdVertexShader from './shaders/birdVertex.glsl?raw';
import birdFragmentShader from './shaders/birdFragment.glsl?raw';

const WIDTH = 32;
const BIRDS = WIDTH * WIDTH;

const BOUNDS = 800;

let container;
let stats;
let camera;
let scene;
let renderer;

let mouseX = 0;
let mouseY = 0;

let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;

let last = performance.now();

let simulation;
let birdUniforms;

init();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        1,
        3000
    );
    camera.position.z = 350;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 100, 1000);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);

    container.appendChild(renderer.domElement);

    simulation = new BoidsSimulation(renderer, WIDTH, BOUNDS);

    stats = new Stats();
    container.appendChild(stats.dom);

    container.style.touchAction = 'none';
    container.addEventListener('pointermove', onPointerMove);

    window.addEventListener('resize', onWindowResize);

    initGui();
    initBirds();
}

function initGui() {
    const gui = new GUI();

    const effectController = {
        separation: 20.0,
        alignment: 20.0,
        cohesion: 20.0,
        freedom: 0.75
    };

    const updateSimulationParameters = () => {
        simulation.setBoidsParameters(effectController);
    };

    updateSimulationParameters();

    gui.add(effectController, 'separation', 0.0, 100.0, 1.0).onChange(updateSimulationParameters);
    gui.add(effectController, 'alignment', 0.0, 100.0, 0.001).onChange(updateSimulationParameters);
    gui.add(effectController, 'cohesion', 0.0, 100.0, 0.025).onChange(updateSimulationParameters);

    gui.close();
}

function initBirds() {
    const geometry = new BirdGeometry(BIRDS, WIDTH);

    birdUniforms = {
        color: { value: new THREE.Color(0xff2200) },
        texturePosition: { value: null },
        textureVelocity: { value: null },
        time: { value: 1.0 },
        delta: { value: 0.0 }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: birdUniforms,
        vertexShader: birdVertexShader,
        fragmentShader: birdFragmentShader,
        side: THREE.DoubleSide
    });

    const birdMesh = new THREE.Mesh(geometry, material);
    birdMesh.rotation.y = Math.PI / 2;
    birdMesh.matrixAutoUpdate = false;
    birdMesh.updateMatrix();

    scene.add(birdMesh);
}

function onWindowResize() {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerMove(event) {
    if (event.isPrimary === false) return;

    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
}

function animate() {
    render();
    stats.update();
}

function render() {
    const now = performance.now();
    let delta = (now - last) / 1000;

    if (delta > 1) delta = 1;

    last = now;

    const predator = new THREE.Vector3(
        0.5 * mouseX / windowHalfX,
        -0.5 * mouseY / windowHalfY,
        0
    );

    simulation.update(now, delta, predator);

    birdUniforms.time.value = now;
    birdUniforms.delta.value = delta;
    birdUniforms.texturePosition.value = simulation.getPositionTexture();
    birdUniforms.textureVelocity.value = simulation.getVelocityTexture();

    mouseX = 10000;
    mouseY = 10000;

    renderer.render(scene, camera);
}