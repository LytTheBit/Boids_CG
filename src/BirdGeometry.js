import * as THREE from 'three';

export class BirdGeometry extends THREE.BufferGeometry {
    constructor(birds, width) {
        super();

        const trianglesPerBird = 3;
        const triangles = birds * trianglesPerBird;
        const points = triangles * 3;

        const vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const birdColors = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const references = new THREE.BufferAttribute(new Float32Array(points * 2), 2);
        const birdVertex = new THREE.BufferAttribute(new Float32Array(points), 1);

        this.setAttribute('position', vertices);
        this.setAttribute('birdColor', birdColors);
        this.setAttribute('reference', references);
        this.setAttribute('birdVertex', birdVertex);

        let v = 0;

        function vertsPush(...values) {
            for (let i = 0; i < values.length; i++) {
                vertices.array[v++] = values[i];
            }
        }

        const wingsSpan = 20;

        for (let f = 0; f < birds; f++) {
            vertsPush(
                0, 0, -20,
                0, 4, -20,
                0, 0, 30
            );

            vertsPush(
                0, 0, -15,
                -wingsSpan, 0, 0,
                0, 0, 15
            );

            vertsPush(
                0, 0, 15,
                wingsSpan, 0, 0,
                0, 0, -15
            );
        }

        for (let v = 0; v < triangles * 3; v++) {
            const triangleIndex = ~~(v / 3);
            const birdIndex = ~~(triangleIndex / trianglesPerBird);
            const x = (birdIndex % width) / width;
            const y = ~~(birdIndex / width) / width;

            const c = new THREE.Color(
                0x666666 +
                ~~(v / 9) / birds * 0x666666
            );

            birdColors.array[v * 3 + 0] = c.r;
            birdColors.array[v * 3 + 1] = c.g;
            birdColors.array[v * 3 + 2] = c.b;

            references.array[v * 2] = x;
            references.array[v * 2 + 1] = y;

            birdVertex.array[v] = v % 9;
        }

        this.scale(0.2, 0.2, 0.2);
    }
}