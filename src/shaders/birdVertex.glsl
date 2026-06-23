/*
 * birdVertex.glsl
 *
 * Vertex shader per renderizzare graficamente i boids.
 *
 * La simulazione fisica non avviene qui, ma negli shader GPGPU
 * fragmentShaderPosition.glsl e fragmentShaderVelocity.glsl.
 *
 * Questo shader:
 * - legge la posizione del boid da texturePosition;
 * - legge la velocità del boid da textureVelocity;
 * - orienta la geometria del boid nella direzione della velocità;
 * - anima il movimento delle ali usando la fase salvata in texturePosition.w;
 * - passa il colore e la profondità al fragment shader.
 */

attribute vec2 reference;
attribute float birdVertex;
attribute vec3 birdColor;

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;

uniform float time;

varying vec4 vColor;
varying float z;

void main() {

    vec4 tmpPos = texture2D(texturePosition, reference);
    vec3 pos = tmpPos.xyz;

    vec3 velocity = normalize(texture2D(textureVelocity, reference).xyz);

    vec3 newPosition = position;

    /*
     * Animazione delle ali.
     * Alcuni vertici specifici vengono spostati lungo l'asse Y
     * per simulare il battito.
     */
    if (birdVertex == 4.0 || birdVertex == 7.0) {
        newPosition.y = sin(tmpPos.w) * 5.0;
    }

    newPosition = mat3(modelMatrix) * newPosition;

    /*
     * Calcolo della rotazione in base alla direzione di volo.
     */
    velocity.z *= -1.0;

    float xz = length(velocity.xz);
    float xyz = 1.0;
    float x = sqrt(1.0 - velocity.y * velocity.y);

    float cosry = velocity.x / xz;
    float sinry = velocity.z / xz;

    float cosrz = x / xyz;
    float sinrz = velocity.y / xyz;

    mat3 maty = mat3(
        cosry, 0.0, -sinry,
        0.0,   1.0,  0.0,
        sinry, 0.0,  cosry
    );

    mat3 matz = mat3(
        cosrz,  sinrz, 0.0,
        -sinrz, cosrz, 0.0,
        0.0,    0.0,   1.0
    );

    newPosition = maty * matz * newPosition;
    newPosition += pos;

    z = newPosition.z;

    vColor = vec4(birdColor, 1.0);

    gl_Position = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
}