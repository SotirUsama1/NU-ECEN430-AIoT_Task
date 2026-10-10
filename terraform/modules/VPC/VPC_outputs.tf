output "vpc_ids" {
  description = "The IDs of the VPCs"
  value       = aws_vpc.example[*].id
}

output "public_subnet_ids" {
  description = "The IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "The IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

output "isolated_subnet_ids" {
  description = "The IDs of the isolated subnets"
  value       = aws_subnet.isolated[*].id
}

output "internet_gateway_ids" {
  description = "The IDs of the internet gateways"
  value       = aws_internet_gateway.main[*].id
}