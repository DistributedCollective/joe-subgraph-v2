export NETWORK=optimism;
red=`tput setaf 1`
yellow=`tput setaf 3`
green=`tput setaf 2`
reset=`tput sgr0`
echo "Preparing subgraph for ${yellow}$NETWORK${reset} network" && echo;
npx mustache config/BOB.mainnet.json subgraph.template.yaml > subgraph.yaml;
echo "File: ${green}subgraph.yaml${reset} has been mustached";
npx mustache config/BOB.mainnet.json docker-compose.template.yml > docker-compose.yml;
echo "File: ${green}docker-compose.yml${reset} has been mustached";