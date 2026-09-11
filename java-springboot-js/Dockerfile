# The Spring Boot example, for docker-compose.yml at the repository root.
#
# Two stages: the jar carries views/ and public/ as resources, so the runtime image is a JRE
# and one file.

# maven:…-21 rather than ./mvnw, which downloads Maven itself on first use — a build stage
# should not spend a network round trip on fetching its own build tool.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
# Tests are `./mvnw verify`'s job; this stage only has to produce the jar, as release.yml does
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /opt/hosted-fields-examples-java
COPY --from=build /src/target/hosted-fields-example-java.jar .
# BASE_PATH becomes the servlet context path in main(), before the container is built, so it is
# an ordinary environment variable here like PORT and LISTEN_ADDR.
CMD ["java", "-jar", "hosted-fields-example-java.jar"]
