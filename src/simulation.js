import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

import fragmentShaderPosition from './shaders/fragmentShaderPosition.glsl?raw';
import fragmentShaderVelocity from './shaders/fragmentShaderVelocity.glsl?raw';

export class BoidsSimulation {
    constructor(renderer, width, bounds) {
        this.renderer = renderer;
        this.width = width;
        this.bounds = bounds;
        this.boundsHalf = bounds / 2;

        this.gpuCompute = null;
        this.positionVariable = null;
        this.velocityVariable = null;
        this.positionUniforms = null;
        this.velocityUniforms = null;

        this.init();
    }

    init() {
        this.gpuCompute = new GPUComputationRenderer(this.width, this.width, this.renderer);

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
        this.velocityUniforms.delta = { value: 0.0 };
        this.velocityUniforms.testing = { value: 1.0 };
        this.velocityUniforms.separationDistance = { value: 1.0 };
        this.velocityUniforms.alignmentDistance = { value: 1.0 };
        this.velocityUniforms.cohesionDistance = { value: 1.0 };
        this.velocityUniforms.freedomFactor = { value: 1.0 };
        this.velocityUniforms.predator = { value: new THREE.Vector3() };

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

        for (let k = 0, kl = array.length; k < kl; k += 4) {
            array[k + 0] = Math.random() * this.bounds - this.boundsHalf;
            array[k + 1] = Math.random() * this.bounds - this.boundsHalf;
            array[k + 2] = Math.random() * this.bounds - this.boundsHalf;
            array[k + 3] = 1;
        }
    }

    fillVelocityTexture(texture) {
        const array = texture.image.data;

        for (let k = 0, kl = array.length; k < kl; k += 4) {
            array[k + 0] = (Math.random() - 0.5) * 10;
            array[k + 1] = (Math.random() - 0.5) * 10;
            array[k + 2] = (Math.random() - 0.5) * 10;
            array[k + 3] = 1;
        }
    }

    setBoidsParameters({ separation, alignment, cohesion, freedom }) {
        this.velocityUniforms.separationDistance.value = separation;
        this.velocityUniforms.alignmentDistance.value = alignment;
        this.velocityUniforms.cohesionDistance.value = cohesion;
        this.velocityUniforms.freedomFactor.value = freedom;
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
}