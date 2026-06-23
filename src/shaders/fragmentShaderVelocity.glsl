/*
 * fragmentShaderVelocity.glsl
 *
 * Shader GPGPU per aggiornare la velocità dei boids.
 *
 * Ogni pixel della texture rappresenta un boid.
 * Per ogni boid, lo shader confronta la sua posizione con quella
 * di tutti gli altri boids leggendo texturePosition e textureVelocity.
 *
 * Implementa le regole classiche del modello Boids:
 *
 * 1. Separation:
 *    evita che i boids siano troppo vicini.
 *
 * 2. Alignment:
 *    tende ad allineare la direzione di volo con i vicini.
 *
 * 3. Cohesion:
 *    tende ad avvicinare il boid al gruppo.
 *
 * Inoltre:
 * - il mouse viene interpretato come predatore;
 * - i boids vengono leggermente richiamati verso il centro della scena;
 * - viene applicato un limite massimo alla velocità.
 *
 * Il risultato viene scritto in gl_FragColor, cioè nella nuova texture
 * di velocità usata al frame successivo.
 */

uniform float time;
uniform float testing;
uniform float delta;
uniform float separationDistance;
uniform float alignmentDistance;
uniform float cohesionDistance;
uniform float freedomFactor;
uniform vec3 predator;

const float width = resolution.x;
const float height = resolution.y;

const float PI = 3.141592653589793;
const float PI_2 = PI * 2.0;

float zoneRadius = 40.0;
float zoneRadiusSquared = 1600.0;

float separationThresh = 0.45;
float alignmentThresh = 0.65;

const float UPPER_BOUNDS = BOUNDS;
const float LOWER_BOUNDS = -UPPER_BOUNDS;

const float SPEED_LIMIT = 9.0;

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {

    zoneRadius = separationDistance + alignmentDistance + cohesionDistance;
    separationThresh = separationDistance / zoneRadius;
    alignmentThresh = (separationDistance + alignmentDistance) / zoneRadius;
    zoneRadiusSquared = zoneRadius * zoneRadius;

    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec3 birdPosition;
    vec3 birdVelocity;

    vec3 selfPosition = texture2D(texturePosition, uv).xyz;
    vec3 selfVelocity = texture2D(textureVelocity, uv).xyz;

    float dist;
    vec3 dir;
    float distSquared;

    float separationSquared = separationDistance * separationDistance;
    float cohesionSquared = cohesionDistance * cohesionDistance;

    float f;
    float percent;

    vec3 velocity = selfVelocity;

    float limit = SPEED_LIMIT;

    /*
     * Fuga dal predatore.
     * Il predatore è controllato dal mouse e viene passato come uniform.
     */
    dir = predator * UPPER_BOUNDS - selfPosition;
    dir.z = 0.0;

    dist = length(dir);
    distSquared = dist * dist;

    float preyRadius = 150.0;
    float preyRadiusSq = preyRadius * preyRadius;

    if (dist < preyRadius) {
        f = (distSquared / preyRadiusSq - 1.0) * delta * 100.0;
        velocity += normalize(dir) * f;
        limit += 5.0;
    }

    /*
     * Attrazione verso il centro.
     * Evita che lo stormo si disperda indefinitamente nello spazio.
     */
    vec3 central = vec3(0.0, 0.0, 0.0);

    dir = selfPosition - central;
    dist = length(dir);

    dir.y *= 2.5;
    velocity -= normalize(dir) * delta * 5.0;

    /*
     * Ciclo su tutti gli altri boids.
     * Ogni boid legge posizione e velocità degli altri dalla texture.
     *
     * Nota: questa è una logica O(N^2), ma viene eseguita parallelamente
     * sulla GPU: ogni frammento calcola un boid diverso.
     */
    for (float y = 0.0; y < height; y++) {
        for (float x = 0.0; x < width; x++) {

            vec2 ref = vec2(x + 0.5, y + 0.5) / resolution.xy;

            birdPosition = texture2D(texturePosition, ref).xyz;

            dir = birdPosition - selfPosition;
            dist = length(dir);

            if (dist < 0.0001) continue;

            distSquared = dist * dist;

            if (distSquared > zoneRadiusSquared) continue;

            percent = distSquared / zoneRadiusSquared;

            if (percent < separationThresh) {

                /*
                 * Separation:
                 * se un vicino è troppo vicino, il boid si allontana.
                 */
                f = (separationThresh / percent - 1.0) * delta;
                velocity -= normalize(dir) * f;

            } else if (percent < alignmentThresh) {

                /*
                 * Alignment:
                 * il boid tende a orientarsi come i vicini.
                 */
                float threshDelta = alignmentThresh - separationThresh;
                float adjustedPercent = (percent - separationThresh) / threshDelta;

                birdVelocity = texture2D(textureVelocity, ref).xyz;

                f = (0.5 - cos(adjustedPercent * PI_2) * 0.5 + 0.5) * delta;
                velocity += normalize(birdVelocity) * f;

            } else {

                /*
                 * Cohesion:
                 * il boid tende ad avvicinarsi ai vicini più lontani,
                 * mantenendo compatto lo stormo.
                 */
                float threshDelta = 1.0 - alignmentThresh;
                float adjustedPercent;

                if (threshDelta == 0.0) {
                    adjustedPercent = 1.0;
                } else {
                    adjustedPercent = (percent - alignmentThresh) / threshDelta;
                }

                f = (0.5 - (cos(adjustedPercent * PI_2) * -0.5 + 0.5)) * delta;
                velocity += normalize(dir) * f;
            }
        }
    }

    /*
     * Limite massimo alla velocità.
     */
    if (length(velocity) > limit) {
        velocity = normalize(velocity) * limit;
    }

    gl_FragColor = vec4(velocity, 1.0);
}