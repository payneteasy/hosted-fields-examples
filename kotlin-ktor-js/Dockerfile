# The Ktor example, for docker-compose.yml at the repository root.
#
# Two stages: the fat jar carries views/ and public/ as resources, so the runtime image is a JRE
# and one file.

# gradle:…-jdk21 rather than ./gradlew, which downloads Gradle itself on first use — a build stage
# should not spend a network round trip on fetching its own build tool.
FROM gradle:9.7.1-jdk21 AS build
WORKDIR /src
COPY . .
# Tests are `./gradlew build`'s job; this stage only has to produce the jar, as release.yml does.
# --no-daemon: a daemon outliving the build stage is a container that never exits.
RUN gradle --no-daemon -q buildFatJar

FROM eclipse-temurin:21-jre
WORKDIR /opt/hosted-fields-examples-kotlin
COPY --from=build /src/build/libs/hosted-fields-example-kotlin.jar .
# PORT, LISTEN_ADDR and the rest arrive as real environment variables from compose. The default
# LISTEN_ADDR is 127.0.0.1 and stays that way: every app shares the nginx container's network
# namespace, so loopback is exactly where nginx looks for it.
CMD ["java", "-jar", "hosted-fields-example-kotlin.jar"]
