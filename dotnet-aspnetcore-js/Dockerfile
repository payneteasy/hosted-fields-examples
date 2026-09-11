# The ASP.NET Core example, for docker-compose.yml at the repository root.
#
# Two stages: views/ and public/ are embedded resources, so the runtime image carries the
# published assembly and nothing beside it.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /src
COPY . .
# The app itself references no package; only the test project does, and it is not published
RUN dotnet publish HostedFields.csproj -c Release -o /out

# aspnet, not runtime: the publish is framework-dependent and this is an ASP.NET Core app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /opt/hosted-fields-examples-dotnet
COPY --from=build /out .
# `dotnet <dll>`, because UseAppHost is off — the archive is meant to be platform-neutral, so
# no native launcher is built for whichever machine happened to publish it.
#
# The image sets ASPNETCORE_HTTP_PORTS=8080, which has no effect: Program.cs calls UseUrls()
# explicitly from PORT and LISTEN_ADDR, and that wins.
CMD ["dotnet", "hosted-fields-example-dotnet.dll"]
