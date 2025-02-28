const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { ResourceManagementClient } = require('@azure/arm-resources');
const logger = require('../utils/logger');

// Azure configuration from environment variables
const config = {
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP,
  location: process.env.AZURE_LOCATION || 'eastus',
  vmName: process.env.VM_NAME || 'twitter-space-vm',
  vmSize: process.env.VM_SIZE || 'Standard_D2s_v3',
  vmUsername: process.env.VM_USERNAME || 'azureuser',
  vmPassword: process.env.VM_PASSWORD,
  vnetName: 'twitter-space-vnet',
  subnetName: 'twitter-space-subnet',
  publicIpName: 'twitter-space-public-ip',
  networkInterfaceName: 'twitter-space-nic',
  securityGroupName: 'twitter-space-nsg',
};

// Initialize Azure clients
let computeClient;
let networkClient;
let resourceClient;
let credential;

/**
 * Initialize Azure clients with credentials
 */
function initializeClients() {
  logger.debug('Initializing Azure clients...');
  
  if (!config.subscriptionId) {
    throw new Error('AZURE_SUBSCRIPTION_ID environment variable is required');
  }
  
  if (!config.vmPassword) {
    throw new Error('VM_PASSWORD environment variable is required');
  }
  
  credential = new DefaultAzureCredential();
  computeClient = new ComputeManagementClient(credential, config.subscriptionId);
  networkClient = new NetworkManagementClient(credential, config.subscriptionId);
  resourceClient = new ResourceManagementClient(credential, config.subscriptionId);
  
  logger.debug('Azure clients initialized successfully');
}

/**
 * Ensure resource group exists
 */
async function ensureResourceGroup() {
  logger.debug(`Ensuring resource group '${config.resourceGroup}' exists...`);
  
  try {
    await resourceClient.resourceGroups.createOrUpdate(config.resourceGroup, {
      location: config.location
    });
    logger.debug(`Resource group '${config.resourceGroup}' ready`);
  } catch (error) {
    logger.error(`Failed to create resource group: ${error.message}`);
    throw error;
  }
}

/**
 * Create a virtual network
 */
async function createVirtualNetwork() {
  logger.debug(`Creating virtual network '${config.vnetName}'...`);
  
  try {
    const vnetParameters = {
      location: config.location,
      addressSpace: {
        addressPrefixes: ['10.0.0.0/16'],
      },
      subnets: [
        {
          name: config.subnetName,
          addressPrefix: '10.0.0.0/24',
        },
      ],
    };
    
    await networkClient.virtualNetworks.beginCreateOrUpdateAndWait(
      config.resourceGroup,
      config.vnetName,
      vnetParameters
    );
    
    logger.debug(`Virtual network '${config.vnetName}' created`);
    
    // Get the subnet
    const subnet = await networkClient.subnets.get(
      config.resourceGroup,
      config.vnetName,
      config.subnetName
    );
    
    return subnet;
  } catch (error) {
    logger.error(`Failed to create virtual network: ${error.message}`);
    throw error;
  }
}

/**
 * Create a network security group with required ports
 */
async function createNetworkSecurityGroup() {
  logger.debug(`Creating network security group '${config.securityGroupName}'...`);
  
  try {
    const securityRules = [
      {
        name: 'default-allow-rdp',
        priority: 1000,
        protocol: 'Tcp',
        access: 'Allow',
        direction: 'Inbound',
        sourceAddressPrefix: '*',
        sourcePortRange: '*',
        destinationAddressPrefix: '*',
        destinationPortRange: '3389',
      },
      {
        name: 'allow-http',
        priority: 1001,
        protocol: 'Tcp',
        access: 'Allow',
        direction: 'Inbound',
        sourceAddressPrefix: '*',
        sourcePortRange: '*',
        destinationAddressPrefix: '*',
        destinationPortRange: '80',
      },
      {
        name: 'allow-https',
        priority: 1002,
        protocol: 'Tcp',
        access: 'Allow',
        direction: 'Inbound',
        sourceAddressPrefix: '*',
        sourcePortRange: '*',
        destinationAddressPrefix: '*',
        destinationPortRange: '443',
      },
    ];
    
    const nsgParameters = {
      location: config.location,
      securityRules: securityRules,
    };
    
    await networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait(
      config.resourceGroup,
      config.securityGroupName,
      nsgParameters
    );
    
    logger.debug(`Network security group '${config.securityGroupName}' created`);
    
    return await networkClient.networkSecurityGroups.get(
      config.resourceGroup,
      config.securityGroupName
    );
  } catch (error) {
    logger.error(`Failed to create network security group: ${error.message}`);
    throw error;
  }
}

/**
 * Create a public IP address
 */
async function createPublicIP() {
  logger.debug(`Creating public IP address '${config.publicIpName}'...`);
  
  try {
    const publicIPParameters = {
      location: config.location,
      publicIPAllocationMethod: 'Dynamic',
      dnsSettings: {
        domainNameLabel: `${config.vmName}-${Date.now()}`,
      },
    };
    
    await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(
      config.resourceGroup,
      config.publicIpName,
      publicIPParameters
    );
    
    logger.debug(`Public IP address '${config.publicIpName}' created`);
    
    return await networkClient.publicIPAddresses.get(
      config.resourceGroup,
      config.publicIpName
    );
  } catch (error) {
    logger.error(`Failed to create public IP address: ${error.message}`);
    throw error;
  }
}

/**
 * Create a network interface
 */
async function createNetworkInterface(subnet, networkSecurityGroup, publicIP) {
  logger.debug(`Creating network interface '${config.networkInterfaceName}'...`);
  
  try {
    const nicParameters = {
      location: config.location,
      ipConfigurations: [
        {
          name: 'ipconfig',
          privateIPAllocationMethod: 'Dynamic',
          subnet: subnet,
          publicIPAddress: publicIP,
        },
      ],
      networkSecurityGroup: networkSecurityGroup,
    };
    
    await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(
      config.resourceGroup,
      config.networkInterfaceName,
      nicParameters
    );
    
    logger.debug(`Network interface '${config.networkInterfaceName}' created`);
    
    return await networkClient.networkInterfaces.get(
      config.resourceGroup,
      config.networkInterfaceName
    );
  } catch (error) {
    logger.error(`Failed to create network interface: ${error.message}`);
    throw error;
  }
}

/**
 * Create a virtual machine
 */
async function createVirtualMachine(networkInterface) {
  logger.debug(`Creating virtual machine '${config.vmName}'...`);
  logger.debug(`Using VM size: ${config.vmSize}`);
  
  try {
    const vmParameters = {
      location: config.location,
      hardwareProfile: {
        vmSize: config.vmSize,
      },
      storageProfile: {
        imageReference: {
          publisher: 'MicrosoftWindowsDesktop',
          offer: 'Windows-10',
          sku: '20h2-pro',
          version: 'latest',
        },
        osDisk: {
          name: `${config.vmName}-osdisk`,
          caching: 'ReadWrite',
          createOption: 'FromImage',
          managedDisk: {
            storageAccountType: 'Premium_LRS',
          },
        },
      },
      osProfile: {
        computerName: config.vmName,
        adminUsername: config.vmUsername,
        adminPassword: config.vmPassword,
        windowsConfiguration: {
          provisionVMAgent: true,
          enableAutomaticUpdates: true,
        },
      },
      networkProfile: {
        networkInterfaces: [
          {
            id: networkInterface.id,
            primary: true,
          },
        ],
      },
    };
    
    await computeClient.virtualMachines.beginCreateOrUpdateAndWait(
      config.resourceGroup,
      config.vmName,
      vmParameters
    );
    
    logger.info(`Virtual machine '${config.vmName}' created successfully`);
    
    return await computeClient.virtualMachines.get(
      config.resourceGroup,
      config.vmName
    );
  } catch (error) {
    logger.error(`Failed to create virtual machine: ${error.message}`);
    throw error;
  }
}

/**
 * Provisions an Azure VM with all necessary resources
 * @returns {Object} VM information including IP address
 */
async function provisionVM() {
  logger.info('Starting VM provisioning process...');
  
  try {
    // Initialize Azure clients
    initializeClients();
    
    // Create resource group
    await ensureResourceGroup();
    
    // Create networking resources
    const subnet = await createVirtualNetwork();
    const nsg = await createNetworkSecurityGroup();
    const publicIP = await createPublicIP();
    const nic = await createNetworkInterface(subnet, nsg, publicIP);
    
    // Create VM
    const vm = await createVirtualMachine(nic);
    
    // Get the public IP address
    const ipAddress = await getPublicIPAddress();
    
    logger.info(`VM provisioned successfully with IP: ${ipAddress}`);
    
    return {
      name: config.vmName,
      ipAddress: ipAddress,
      username: config.vmUsername,
      password: config.vmPassword
    };
  } catch (error) {
    logger.error(`VM provisioning failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get the public IP address of the VM
 */
async function getPublicIPAddress() {
  logger.debug('Getting public IP address...');
  
  try {
    const publicIP = await networkClient.publicIPAddresses.get(
      config.resourceGroup,
      config.publicIpName
    );
    
    return publicIP.ipAddress;
  } catch (error) {
    logger.error(`Failed to get public IP address: ${error.message}`);
    throw error;
  }
}

/**
 * Terminates the Azure VM and cleans up resources
 * @param {string} vmName - Name of the VM to terminate
 */
async function terminateVM(vmName) {
  logger.info(`Terminating VM: ${vmName}...`);
  
  try {
    // Initialize Azure clients if not already done
    if (!computeClient) {
      initializeClients();
    }
    
    // Delete VM
    await computeClient.virtualMachines.beginDeleteAndWait(
      config.resourceGroup,
      vmName
    );
    
    logger.info(`VM ${vmName} terminated successfully`);
    
    // Optionally, clean up other resources
    // This is commented out to prevent accidental deletion of shared resources
    /*
    await networkClient.networkInterfaces.beginDeleteAndWait(
      config.resourceGroup,
      config.networkInterfaceName
    );
    
    await networkClient.publicIPAddresses.beginDeleteAndWait(
      config.resourceGroup,
      config.publicIpName
    );
    
    await networkClient.networkSecurityGroups.beginDeleteAndWait(
      config.resourceGroup,
      config.securityGroupName
    );
    
    await networkClient.virtualNetworks.beginDeleteAndWait(
      config.resourceGroup,
      config.vnetName
    );
    */
    
    return true;
  } catch (error) {
    logger.error(`VM termination failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  provisionVM,
  terminateVM
}; 