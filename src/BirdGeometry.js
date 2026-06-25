import * as THREE from 'three';

/*
 * BirdGeometry.js
 *
 * Definisce la geometria visuale dei boids.
 *
 * Ogni boid è rappresentato da 3 triangoli:
 * - corpo centrale;
 * - ala sinistra;
 * - ala destra.
 *
 * La geometria contiene anche:
 * - reference: coordinate UV per leggere posizione e velocità dalla texture GPGPU;
 * - birdVertex: indice del vertice, usato nello shader per animare le ali;
 * - birdColor: colore del boid, assegnato in base alla specie.
 *
 * Le specie sono distribuite in modo il più possibile uniforme.
 * Esempio:
 * - 100 boids, 4 specie -> 25 boids per specie;
 * - 100 boids, 3 specie -> circa 34, 33, 33.
 */

const SPECIES_COLORS = [
    0x333333, // grigio scuro
    0x1f5eff, // blu
    0x55ccff, // azzurro
    0x22aa44, // verde
    0x20c997, // verdeacqua
    0xffaa00, // arancione
    0xaa55ff, // viola
    0xff5577  // rosa
];

export class BirdGeometry extends THREE.BufferGeometry {
    constructor(boidCount, textureWidth, speciesCount) {
        super();

        const trianglesPerBird = 3;
        const triangles = boidCount * trianglesPerBird;
        const points = triangles * 3;

        const vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const birdColors = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const references = new THREE.BufferAttribute(new Float32Array(points * 2), 2);
        const birdVertex = new THREE.BufferAttribute(new Float32Array(points), 1);

        this.setAttribute('position', vertices);
        this.setAttribute('birdColor', birdColors);
        this.setAttribute('reference', references);
        this.setAttribute('birdVertex', birdVertex);

        let vertexArrayIndex = 0;

        function vertsPush(...values) {
            for (let i = 0; i < values.length; i++) {
                vertices.array[vertexArrayIndex++] = values[i];
            }
        }

        const wingsSpan = 20;

        for (let i = 0; i < boidCount; i++) {
            // Corpo
            vertsPush(
                0, 0, -20,
                0, 4, -20,
                0, 0, 30
            );

            // Ala sinistra
            vertsPush(
                0, 0, -15,
                -wingsSpan, 0, 0,
                0, 0, 15
            );

            // Ala destra
            vertsPush(
                0, 0, 15,
                wingsSpan, 0, 0,
                0, 0, -15
            );
        }

        for (let v = 0; v < triangles * 3; v++) {
            const triangleIndex = Math.floor(v / 3);
            const birdIndex = Math.floor(triangleIndex / trianglesPerBird);

            /*
             * Coordinate UV nella texture GPGPU.
             * Ogni boid corrisponde a un pixel della texture.
             * Usiamo + 0.5 per puntare al centro del pixel.
             */
            const x = ((birdIndex % textureWidth) + 0.5) / textureWidth;
            const y = (Math.floor(birdIndex / textureWidth) + 0.5) / textureWidth;

            const speciesIndex = Math.floor(birdIndex * speciesCount / boidCount);
            const color = new THREE.Color(SPECIES_COLORS[speciesIndex % SPECIES_COLORS.length]);

            birdColors.array[v * 3 + 0] = color.r;
            birdColors.array[v * 3 + 1] = color.g;
            birdColors.array[v * 3 + 2] = color.b;

            references.array[v * 2 + 0] = x;
            references.array[v * 2 + 1] = y;

            birdVertex.array[v] = v % 9;
        }

        this.scale(0.2, 0.2, 0.2);
    }
}