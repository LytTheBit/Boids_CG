/*
 * fragmentShaderPosition.glsl
 *
 * Shader GPGPU per aggiornare la posizione dei boids.
 *
 * Ogni pixel della texture rappresenta un singolo boid.
 * La texturePosition contiene la posizione corrente:
 *   x, y, z = posizione nello spazio 3D
 *   w       = fase dell'animazione delle ali
 *
 * La textureVelocity contiene la velocità corrente del boid.
 *
 * Questo shader calcola:
 *   nuova posizione = posizione corrente + velocità * delta * fattore
 *
 * Il risultato viene scritto in gl_FragColor, cioè nella nuova texture
 * di posizione usata al frame successivo.
 */

uniform float time;
uniform float delta;

void main() {

    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec4 tmpPos = texture2D(texturePosition, uv);
    vec3 position = tmpPos.xyz;
    vec3 velocity = texture2D(textureVelocity, uv).xyz;

    float phase = tmpPos.w;

    phase = mod(
        (
            phase +
            delta +
            length(velocity.xz) * delta * 3.0 +
            max(velocity.y, 0.0) * delta * 6.0
        ),
        62.83
    );

    gl_FragColor = vec4(position + velocity * delta * 15.0, phase);
}