import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

import fragmentShaderPosition from './shaders/fragmentShaderPosition.glsl?raw';
import fragmentShaderVelocity from './shaders/fragmentShaderVelocity.glsl?raw';

/*
 * simulation.js
 *
 * Gestisce la simulazione GPGPU dei boids.
 *
 * Le posizioni e le velocità non sono salvate in array JavaScript,
 * ma in texture GPU:
 *
 * - texturePosition: posizione x, y, z e fase delle ali;
 * - textureVelocity: velocità x, y, z.
 *
 * Ogni pixel della texture rappresenta un boid.
 *
 * Il numero di boids può essere modificato dalla GUI.
 * Quando cambia, la simulazione deve essere ricostruita.
 */

export class BoidsSimulation {
    constructor(renderer, boidCount, speciesCount, bounds) {
        this.renderer = renderer;
        this.boidCount = boidCount;
        this.speciesCount = speciesCount;
        this.bounds = bounds;
        this.boundsHalf = bounds / 2;

        this.textureWidth = Math.ceil(Math.sqrt(boidCount));
        this.textureSize = this.textureWidth * this.textureWidth;

        this.gpuCompute = null;
        this.positionVariable = null;
        this.velocityVariable = null;
        this.positionUniforms = null;
        this.velocityUniforms = null;

        this.init();
    }

    init() {
        this.gpuCompute = new GPUComputationRenderer(
            this.textureWidth,
            this.textureWidth,
            this.renderer
        );

        const dtPosition = this.gpuCompute.createTexture();
        const dtVelocity = this.gpuCompute.createTexture();

        this.fillPositionTexture(dtPosition);
        this.fillVelocityTexture(dtVelocity);

        this.velocityVariable = this.gpuCompute.addVariable(
            'textureVelocity',
            fragmentShaderVelocity,
            dtVelocity
        );

        this.positionVariable = this.gpuCompute.addVariable(
            'texturePosition',
            fragmentShaderPosition,
            dtPosition
        );

        this.gpuCompute.setVariableDependencies(this.velocityVariable, [
            this.positionVariable,
            this.velocityVariable
        ]);

        this.gpuCompute.setVariableDependencies(this.positionVariable, [
            this.positionVariable,
            this.velocityVariable
        ]);

        this.positionUniforms = this.positionVariable.material.uniforms;
        this.velocityUniforms = this.velocityVariable.material.uniforms;

        this.positionUniforms.time = { value: 0.0 };
        this.positionUniforms.delta = { value: 0.0 };

        this.velocityUniforms.time = { value: 1.0 };
        this.velocityUniforms.testing = { value: 1.0 };
        this.velocityUniforms.delta = { value: 0.0 };

        this.velocityUniforms.separationDistance = { value: 1.0 };
        this.velocityUniforms.alignmentDistance = { value: 1.0 };
        this.velocityUniforms.cohesionDistance = { value: 1.0 };
        this.velocityUniforms.freedomFactor = { value: 1.0 };
        this.velocityUniforms.centerPull = { value: 5.0 }; // valore di default = comportamento precedente

        this.velocityUniforms.predator = { value: new THREE.Vector3() };

        /*
         * Nuove uniform:
         * - boidCount serve a ignorare eventuali pixel non usati;
         * - speciesCount serve a calcolare la specie di ogni boid nello shader.
         */
        this.velocityUniforms.boidCount = { value: this.boidCount };
        this.velocityUniforms.speciesCount = { value: this.speciesCount };

        this.velocityVariable.material.defines.BOUNDS = this.bounds.toFixed(2);

        this.velocityVariable.wrapS = THREE.RepeatWrapping;
        this.velocityVariable.wrapT = THREE.RepeatWrapping;
        this.positionVariable.wrapS = THREE.RepeatWrapping;
        this.positionVariable.wrapT = THREE.RepeatWrapping;

        const error = this.gpuCompute.init();

        if (error !== null) {
            console.error(error);
        }
    }

    fillPositionTexture(texture) {
        const array = texture.image.data;

        for (let k = 0, i = 0; k < array.length; k += 4, i++) {
            if (i < this.boidCount) {
                array[k + 0] = Math.random() * this.bounds - this.boundsHalf;
                array[k + 1] = Math.random() * this.bounds - this.boundsHalf;
                array[k + 2] = Math.random() * this.bounds - this.boundsHalf;
                array[k + 3] = 1;
            } else {
                /*
                 * Slot non usati.
                 * Esistono solo perché la texture deve essere quadrata.
                 */
                array[k + 0] = 0;
                array[k + 1] = 0;
                array[k + 2] = 0;
                array[k + 3] = 1;
            }
        }
    }

    fillVelocityTexture(texture) {
        const array = texture.image.data;

        for (let k = 0, i = 0; k < array.length; k += 4, i++) {
            if (i < this.boidCount) {
                array[k + 0] = (Math.random() - 0.5) * 10;
                array[k + 1] = (Math.random() - 0.5) * 10;
                array[k + 2] = (Math.random() - 0.5) * 10;
                array[k + 3] = 1;
            } else {
                array[k + 0] = 0;
                array[k + 1] = 0;
                array[k + 2] = 0;
                array[k + 3] = 1;
            }
        }
    }

    setBoidsParameters({ separation, alignment, cohesion, freedom, centered }) {
        this.velocityUniforms.separationDistance.value = separation;
        this.velocityUniforms.alignmentDistance.value = alignment;
        this.velocityUniforms.cohesionDistance.value = cohesion;
        this.velocityUniforms.freedomFactor.value = freedom;
        this.velocityUniforms.centerPull.value = centered;
    }

    update(time, delta, predator) {
        this.positionUniforms.time.value = time;
        this.positionUniforms.delta.value = delta;

        this.velocityUniforms.time.value = time;
        this.velocityUniforms.delta.value = delta;
        this.velocityUniforms.predator.value.copy(predator);

        this.gpuCompute.compute();
    }

    getPositionTexture() {
        return this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
    }

    getVelocityTexture() {
        return this.gpuCompute.getCurrentRenderTarget(this.velocityVariable).texture;
    }

    getTextureWidth() {
        return this.textureWidth;
    }

    dispose() {
        /*
         * GPUComputationRenderer nelle versioni recenti di Three.js espone dispose().
         * Il controllo evita errori se la funzione non fosse disponibile.
         */
        if (this.gpuCompute && typeof this.gpuCompute.dispose === 'function') {
            this.gpuCompute.dispose();
        }
    }
}